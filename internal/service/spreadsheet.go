package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"io"
	"math"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/MARETU01/gothrough/internal/utils"
	"github.com/xuri/excelize/v2"
	"uuid"
)

const (
	MaxSpreadsheetBytes   = 10 << 20
	maxSpreadsheetUnzip   = 32 << 20
	MaxSpreadsheetRows    = 2000
	MaxSpreadsheetColumns = 100
	maxSpreadsheetCells   = 20000
	MaxSpreadsheetChanges = 100
)

var (
	ErrSpreadsheet       = errors.New("无效或不支持的 XLSX 工作簿")
	ErrSpreadsheetLimit  = errors.New("工作簿超出预览或编辑限制")
	ErrSpreadsheetChange = errors.New("单元格修改无效，或目标单元格只读")
	spreadsheetNumber    = regexp.MustCompile(`^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$`)
)

type SpreadsheetCell struct {
	Value   string `json:"value"`
	Raw     string `json:"raw"`
	Type    string `json:"type"`
	Formula string `json:"formula,omitempty"`
}

type SpreadsheetSheet struct {
	Name     string                     `json:"name"`
	Rows     int                        `json:"rows"`
	Columns  int                        `json:"columns"`
	ReadOnly bool                       `json:"read_only"`
	Cells    map[string]SpreadsheetCell `json:"cells"`
}

type SpreadsheetPreview struct {
	Kind     string             `json:"kind"`
	MimeType string             `json:"mime_type"`
	Text     string             `json:"text"`
	Version  string             `json:"version"`
	Sheets   []SpreadsheetSheet `json:"sheets"`
}

type SpreadsheetChange struct {
	Sheet string `json:"sheet"`
	Cell  string `json:"cell"`
	Type  string `json:"type"`
	Value string `json:"value"`
}

func (s *FileService) admitSpreadsheet() (func(), error) {
	select {
	case s.spreadsheetSlots <- struct{}{}:
		return func() { <-s.spreadsheetSlots }, nil
	default:
		return nil, ErrBusy
	}
}

func (s *FileService) spreadsheetBytes(filename string) ([]byte, error) {
	if !strings.EqualFold(filepath.Ext(filename), ".xlsx") {
		return nil, ErrSpreadsheet
	}
	file, info, err := s.OpenFile(filename)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	if info.Size() > MaxSpreadsheetBytes {
		return nil, ErrSpreadsheetLimit
	}
	data, err := io.ReadAll(io.LimitReader(file, MaxSpreadsheetBytes+1))
	if err != nil {
		return nil, utils.StorageError("读取工作簿失败", err)
	}
	if len(data) > MaxSpreadsheetBytes {
		return nil, ErrSpreadsheetLimit
	}
	return data, nil
}

func spreadsheetCoordinate(cell string) (int, int, bool) {
	col, row, err := excelize.CellNameToCoordinates(cell)
	if err != nil || row > MaxSpreadsheetRows || col > MaxSpreadsheetColumns {
		return 0, 0, false
	}
	canonical, _ := excelize.CoordinatesToCellName(col, row)
	return col, row, cell == canonical
}

// Bound decompression and sparse coordinates before Excelize can materialize rows.
// Protected/merged sheets are viewable, but intentionally read-only in this editor.
func validateSpreadsheetArchive(ctx context.Context, data []byte) error {
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return ErrSpreadsheet
	}
	if len(archive.File) > 2000 {
		return ErrSpreadsheetLimit
	}
	var total uint64
	seen := make(map[string]bool)
	validatedSheets := make(map[string]bool)
	var sheetTargets []string
	cells, sheets := 0, 0
	for _, entry := range archive.File {
		if err := ctx.Err(); err != nil {
			return err
		}
		if strings.Contains(entry.Name, "\\") || strings.HasPrefix(entry.Name, "/") || path.Clean(strings.TrimSuffix(entry.Name, "/")) != strings.TrimSuffix(entry.Name, "/") || strings.HasPrefix(entry.Name, "../") {
			return ErrSpreadsheet
		}
		key := strings.ToLower(entry.Name)
		if seen[key] {
			return ErrSpreadsheet
		}
		seen[key] = true
		if entry.UncompressedSize64 > maxSpreadsheetUnzip || total > maxSpreadsheetUnzip-entry.UncompressedSize64 {
			return ErrSpreadsheetLimit
		}
		total += entry.UncompressedSize64
		if strings.HasPrefix(key, "_xmlsignatures/") || strings.HasSuffix(key, "vbaproject.bin") {
			return ErrSpreadsheet
		}
		if !strings.HasSuffix(key, ".xml") && key != "xl/_rels/workbook.xml.rels" {
			continue
		}
		isWorksheet := false
		reader, err := entry.Open()
		if err != nil {
			return ErrSpreadsheet
		}
		decoder := xml.NewDecoder(io.LimitReader(reader, maxSpreadsheetUnzip+1))
		err = func() error {
			rows := 0
			for {
				if err := ctx.Err(); err != nil {
					return err
				}
				token, err := decoder.Token()
				if err == io.EOF {
					return nil
				}
				if err != nil {
					return ErrSpreadsheet
				}
				start, ok := token.(xml.StartElement)
				if !ok {
					continue
				}
				if start.Name.Local == "worksheet" && !isWorksheet {
					isWorksheet = true
					sheets++
					validatedSheets[entry.Name] = true
					if sheets > 20 {
						return ErrSpreadsheetLimit
					}
				}
				if key == "xl/_rels/workbook.xml.rels" && start.Name.Local == "Relationship" {
					attrs := make(map[string]string)
					for _, attr := range start.Attr {
						attrs[attr.Name.Local] = attr.Value
					}
					if strings.HasSuffix(attrs["Type"], "/worksheet") {
						if attrs["TargetMode"] == "External" {
							return ErrSpreadsheet
						}
						target := attrs["Target"]
						if strings.HasPrefix(target, "/") {
							target = strings.TrimPrefix(target, "/")
						} else {
							target = path.Join("xl", target)
						}
						sheetTargets = append(sheetTargets, target)
					}
				}
				if !isWorksheet {
					for _, attr := range start.Attr {
						if attr.Name.Local == "ContentType" && strings.Contains(strings.ToLower(attr.Value), "macroenabled") {
							return ErrSpreadsheet
						}
					}
					continue
				}
				if start.Name.Local == "row" {
					rows++
					if rows > MaxSpreadsheetRows {
						return ErrSpreadsheetLimit
					}
					for _, attr := range start.Attr {
						if attr.Name.Local == "r" {
							n, err := strconv.Atoi(attr.Value)
							if err != nil || n < 1 || n > MaxSpreadsheetRows {
								return ErrSpreadsheetLimit
							}
						}
					}
				}
				if start.Name.Local == "c" {
					cells++
					if cells > maxSpreadsheetCells {
						return ErrSpreadsheetLimit
					}
					valid := false
					for _, attr := range start.Attr {
						if attr.Name.Local == "r" {
							_, _, valid = spreadsheetCoordinate(attr.Value)
						}
					}
					if !valid {
						return ErrSpreadsheetLimit
					}
				}
				if start.Name.Local == "mergeCell" {
					for _, attr := range start.Attr {
						if attr.Name.Local == "ref" {
							for _, cell := range strings.Split(attr.Value, ":") {
								if _, _, ok := spreadsheetCoordinate(cell); !ok {
									return ErrSpreadsheetLimit
								}
							}
						}
					}
				}
			}
		}()
		reader.Close()
		if err != nil {
			return err
		}
	}
	if !seen["xl/workbook.xml"] || !seen["[content_types].xml"] || sheets == 0 {
		return ErrSpreadsheet
	}
	if len(sheetTargets) == 0 {
		return ErrSpreadsheet
	}
	for _, target := range sheetTargets {
		if !validatedSheets[target] {
			return ErrSpreadsheet
		}
	}
	return nil
}

func openSpreadsheet(ctx context.Context, data []byte) (*excelize.File, error) {
	if err := validateSpreadsheetArchive(ctx, data); err != nil {
		return nil, err
	}
	book, err := excelize.OpenReader(bytes.NewReader(data), excelize.Options{UnzipSizeLimit: maxSpreadsheetUnzip, UnzipXMLSizeLimit: maxSpreadsheetUnzip})
	if err != nil {
		return nil, ErrSpreadsheet
	}
	return book, nil
}

func spreadsheetProtected(ctx context.Context, data []byte) bool {
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return true
	}
	for _, entry := range archive.File {
		if ctx.Err() != nil {
			return true
		}
		if strings.EqualFold(entry.Name, "xl/metadata.xml") {
			return true
		} // dynamic-array metadata
		if !strings.HasSuffix(strings.ToLower(entry.Name), ".xml") {
			continue
		}
		reader, err := entry.Open()
		if err != nil {
			return true
		}
		decoder := xml.NewDecoder(io.LimitReader(reader, maxSpreadsheetUnzip+1))
		protected := false
		for {
			if ctx.Err() != nil {
				reader.Close()
				return true
			}
			token, err := decoder.Token()
			if err != nil {
				protected = err != io.EOF
				break
			}
			if start, ok := token.(xml.StartElement); ok && (start.Name.Local == "sheetProtection" || start.Name.Local == "workbookProtection") {
				protected = true
				break
			}
			if start, ok := token.(xml.StartElement); ok && start.Name.Local == "f" {
				for _, attr := range start.Attr {
					if attr.Name.Local == "t" && (attr.Value == "array" || attr.Value == "dataTable") {
						protected = true
					}
				}
				if protected {
					break
				}
			}
		}
		reader.Close()
		if protected {
			return true
		}
	}
	return false
}

func spreadsheetSnapshot(ctx context.Context, book *excelize.File, version string, protected bool) (*SpreadsheetPreview, error) {
	result := &SpreadsheetPreview{Kind: "spreadsheet", MimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Version: version, Sheets: []SpreadsheetSheet{}}
	if len(book.GetSheetList()) > 20 {
		return nil, ErrSpreadsheetLimit
	}
	textBytes := 0
	gridCells := 0
	for _, name := range book.GetSheetList() {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		rows, err := book.GetRows(name, excelize.Options{RawCellValue: true})
		if err != nil {
			return nil, ErrSpreadsheet
		}
		if len(rows) > MaxSpreadsheetRows {
			return nil, ErrSpreadsheetLimit
		}
		width := 0
		for _, row := range rows {
			width = max(width, len(row))
		}
		gridCells += len(rows) * width
		if width > MaxSpreadsheetColumns || gridCells > 100000 {
			return nil, ErrSpreadsheetLimit
		}
		merges, err := book.GetMergeCells(name, true)
		if err != nil {
			return nil, ErrSpreadsheet
		}
		sheet := SpreadsheetSheet{Name: name, Rows: len(rows), ReadOnly: len(merges) > 0 || protected, Cells: make(map[string]SpreadsheetCell)}
		for r, row := range rows {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			if len(row) > MaxSpreadsheetColumns {
				return nil, ErrSpreadsheetLimit
			}
			sheet.Columns = max(sheet.Columns, len(row))
			for c := range row {
				cell, _ := excelize.CoordinatesToCellName(c+1, r+1)
				raw, err := book.GetCellValue(name, cell, excelize.Options{RawCellValue: true})
				if err != nil {
					return nil, ErrSpreadsheet
				}
				formula, err := book.GetCellFormula(name, cell)
				if err != nil {
					return nil, ErrSpreadsheet
				}
				if raw == "" && formula == "" {
					continue
				}
				value, err := book.GetCellValue(name, cell)
				if err != nil {
					return nil, ErrSpreadsheet
				}
				kind, err := book.GetCellType(name, cell)
				if err != nil {
					return nil, ErrSpreadsheet
				}
				typeName := "text"
				if kind == excelize.CellTypeNumber || kind == excelize.CellTypeUnset {
					typeName = "number"
				}
				if kind == excelize.CellTypeBool {
					typeName = "boolean"
					raw = strconv.FormatBool(raw == "1" || strings.EqualFold(raw, "true"))
				}
				if formula != "" || kind == excelize.CellTypeError || kind == excelize.CellTypeDate {
					typeName = "readonly"
				}
				textBytes += len(raw) + len(value) + len(formula)
				if textBytes > 2<<20 {
					return nil, ErrSpreadsheetLimit
				}
				sheet.Cells[cell] = SpreadsheetCell{Value: value, Raw: raw, Type: typeName, Formula: formula}
			}
		}
		result.Sheets = append(result.Sheets, sheet)
	}
	if len(result.Sheets) == 0 {
		return nil, ErrSpreadsheet
	}
	return result, nil
}

func (s *FileService) PreviewSpreadsheet(ctx context.Context, filename string) (*SpreadsheetPreview, error) {
	release, err := s.admitSpreadsheet()
	if err != nil {
		return nil, err
	}
	defer release()
	data, err := s.spreadsheetBytes(filename)
	if err != nil {
		return nil, err
	}
	book, err := openSpreadsheet(ctx, data)
	if err != nil {
		return nil, err
	}
	defer book.Close()
	return spreadsheetSnapshot(ctx, book, TextVersion(data), spreadsheetProtected(ctx, data))
}

func (s *FileService) SaveSpreadsheet(ctx context.Context, filename, version string, changes []SpreadsheetChange) (*SpreadsheetPreview, error) {
	return s.saveSpreadsheet(ctx, filename, version, changes, "")
}

func (s *FileService) saveSpreadsheet(ctx context.Context, filename, version string, changes []SpreadsheetChange, operationID string) (*SpreadsheetPreview, error) {
	if version == "" {
		return nil, ErrTextConflict
	}
	if len(changes) == 0 || len(changes) > MaxSpreadsheetChanges {
		return nil, ErrSpreadsheetChange
	}
	release, err := s.admitSpreadsheet()
	if err != nil {
		return nil, err
	}
	defer release()
	data, err := s.spreadsheetBytes(filename)
	if err != nil {
		return nil, err
	}
	if TextVersion(data) != version {
		return nil, ErrTextConflict
	}
	book, err := openSpreadsheet(ctx, data)
	if err != nil {
		return nil, err
	}
	defer book.Close()
	snapshot, err := spreadsheetSnapshot(ctx, book, version, spreadsheetProtected(ctx, data))
	if err != nil {
		return nil, err
	}
	sheets := make(map[string]SpreadsheetSheet)
	for _, sheet := range snapshot.Sheets {
		sheets[sheet.Name] = sheet
	}
	seen := make(map[string]bool)
	for _, change := range changes {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		sheet, ok := sheets[change.Sheet]
		key := change.Sheet + "\x00" + change.Cell
		_, _, valid := spreadsheetCoordinate(change.Cell)
		if !ok || !valid || sheet.ReadOnly || sheet.Cells[change.Cell].Type == "readonly" || seen[key] || !utf8.ValidString(change.Value) || strings.IndexFunc(change.Value, func(r rune) bool { return r < 32 && r != '\t' && r != '\n' && r != '\r' }) >= 0 || len(change.Value) > 16384 {
			return nil, ErrSpreadsheetChange
		}
		seen[key] = true
		switch change.Type {
		case "text":
			err = book.SetCellStr(change.Sheet, change.Cell, change.Value)
		case "number":
			if !spreadsheetNumber.MatchString(change.Value) {
				return nil, ErrSpreadsheetChange
			}
			var value float64
			value, err = strconv.ParseFloat(change.Value, 64)
			if err == nil && (math.IsNaN(value) || math.IsInf(value, 0)) {
				err = ErrSpreadsheetChange
			}
			if err == nil {
				err = book.SetCellValue(change.Sheet, change.Cell, value)
			}
		case "boolean":
			if change.Value != "true" && change.Value != "false" {
				return nil, ErrSpreadsheetChange
			}
			err = book.SetCellBool(change.Sheet, change.Cell, change.Value == "true")
		case "clear":
			if change.Value != "" {
				return nil, ErrSpreadsheetChange
			}
			err = book.SetCellValue(change.Sheet, change.Cell, nil)
		default:
			return nil, ErrSpreadsheetChange
		}
		if err != nil {
			return nil, ErrSpreadsheetChange
		}
	}
	fullCalc := true
	if err := book.SetCalcProps(&excelize.CalcPropsOptions{FullCalcOnLoad: &fullCalc, ForceFullCalc: &fullCalc}); err != nil {
		return nil, ErrSpreadsheet
	}
	buffer, err := book.WriteToBuffer()
	if err != nil {
		return nil, ErrSpreadsheet
	}
	updated := buffer.Bytes()
	if len(updated) > MaxSpreadsheetBytes {
		return nil, ErrSpreadsheetLimit
	}
	// Reopen exactly the bytes to be published, so previews and versions agree.
	check, err := openSpreadsheet(ctx, updated)
	if err != nil {
		return nil, err
	}
	result, err := spreadsheetSnapshot(ctx, check, TextVersion(updated), spreadsheetProtected(ctx, updated))
	check.Close()
	if err != nil {
		return nil, err
	}
	if err := s.replaceSpreadsheet(ctx, filename, version, updated, operationID); err != nil {
		return nil, err
	}
	return result, nil
}

// Parsing/serialization runs outside mutation locks. Recheck the original under
// the shared coordinator before publication; never recreate a deleted workbook.
func (s *FileService) replaceSpreadsheet(ctx context.Context, filename, version string, updated []byte, operationIDs ...string) error {
	rel := s.RelativePath(filename)
	if rel == "" {
		return ErrFileInaccessible
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.deletionOverlaps(filepath.ToSlash(rel)) {
		return ErrPathDeleting
	}
	root, err := os.OpenRoot(s.uploadDir)
	if err != nil {
		return err
	}
	defer root.Close()
	info, err := selectionInfo(root, filepath.ToSlash(rel))
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return ErrFileInaccessible
	}
	if info.Size() > MaxSpreadsheetBytes {
		return ErrSpreadsheetLimit
	}
	file, err := root.Open(rel)
	if err != nil {
		return err
	}
	data, readErr := io.ReadAll(io.LimitReader(file, MaxSpreadsheetBytes+1))
	err = errors.Join(readErr, file.Close())
	if err != nil {
		return err
	}
	if TextVersion(data) != version {
		return ErrTextConflict
	}
	if info.Mode().Perm()&0222 == 0 {
		return os.ErrPermission
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	s.listingMu.Lock()
	defer s.listingMu.Unlock()
	tempName := filepath.Join(filepath.Dir(rel), ".gothrough-edit-"+uuid.NewV7().String()+".tmp")
	temp, err := root.OpenFile(tempName, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer root.Remove(tempName)
	_, writeErr := temp.Write(updated)
	if writeErr == nil {
		writeErr = temp.Chmod(info.Mode().Perm())
	}
	if writeErr == nil {
		writeErr = temp.Sync()
	}
	if err := errors.Join(writeErr, temp.Close()); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := root.Rename(tempName, rel); err != nil {
		return err
	}
	if len(operationIDs) > 0 && operationIDs[0] != "" {
		id := operationIDs[0]
		receipt := s.spreadsheetSaves[id]
		receipt.version = TextVersion(updated)
		receipt.expires = time.Now().Add(spreadsheetSaveLifetime)
		s.spreadsheetSaves[id] = receipt
	}
	s.listing = nil
	return nil
}
