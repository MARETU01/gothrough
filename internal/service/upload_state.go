package service

import "github.com/MARETU01/gothrough/internal/model"

// UploadState contains either an active snapshot or a completed receipt.
// Neither returned value shares mutable session state.
type UploadState struct {
	Session    *model.UploadSession
	Completion *model.UploadCompletion
}

func (s *UploadService) LookupUpload(id string) (UploadState, error) {
	if result, ok := s.GetCompletion(id); ok {
		return UploadState{Completion: &result}, nil
	}
	session, err := s.GetSession(id)
	if err != nil {
		// Completion can remove the active session between these two lookups.
		if result, ok := s.GetCompletion(id); ok {
			return UploadState{Completion: &result}, nil
		}
		return UploadState{}, err
	}
	return UploadState{Session: session}, nil
}
