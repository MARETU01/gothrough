package utils

// DiskUsage describes filesystem capacity in bytes.
type DiskUsage struct {
	Total       uint64
	Used        uint64
	Free        uint64
	UsedPercent float64
}

// GetDiskUsage queries the filesystem containing path using the standard library.
func GetDiskUsage(path string) (DiskUsage, error) {
	total, free, available, err := diskSpace(path)
	if err != nil {
		return DiskUsage{}, err
	}
	usage := DiskUsage{Total: total, Used: total - free, Free: available}
	if denominator := float64(usage.Used) + float64(available); denominator > 0 {
		usage.UsedPercent = float64(usage.Used) / denominator * 100
	}
	return usage, nil
}
