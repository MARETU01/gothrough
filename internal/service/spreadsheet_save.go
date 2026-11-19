package service

import "context"

// Retain the spreadsheet API's existing error mapping and response shape.
var ErrSpreadsheetOperation = ErrSaveOperation

type SpreadsheetSaveResult struct {
	Status  string              `json:"status"`
	Version string              `json:"version,omitempty"`
	Preview *SpreadsheetPreview `json:"preview,omitempty"`
}

func (s *FileService) SaveSpreadsheetOperation(ctx context.Context, filename, version string, changes []SpreadsheetChange, id string) (*SpreadsheetSaveResult, error) {
	status, cleanup, err := s.beginSaveOperation("spreadsheet", filename, version, changes, id)
	if err != nil {
		return nil, err
	}
	if status.Status == "saved" {
		return &SpreadsheetSaveResult{Status: status.Status, Version: status.Version}, nil
	}
	defer cleanup()
	preview, err := s.saveSpreadsheet(ctx, filename, version, changes, id)
	if err != nil {
		return nil, err
	}
	return &SpreadsheetSaveResult{Status: "saved", Version: preview.Version, Preview: preview}, nil
}

func (s *FileService) SpreadsheetSaveStatus(filename, id string) SpreadsheetSaveResult {
	status := s.saveOperationStatus("spreadsheet", filename, id)
	return SpreadsheetSaveResult{Status: status.Status, Version: status.Version}
}
