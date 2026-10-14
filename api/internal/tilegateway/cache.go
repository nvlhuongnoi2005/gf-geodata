// Package tilegateway keeps private MBTiles artifacts on a local ephemeral
// cache. The browser only talks to authenticated HTTP endpoints.
package tilegateway

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type Cache struct {
	directory string
	client    *s3.Client
	bucket    string
	mu        sync.Mutex
}

func NewCache(directory, bucket string, client *s3.Client) (*Cache, error) {
	if err := os.MkdirAll(directory, 0o750); err != nil {
		return nil, fmt.Errorf("create tile cache: %w", err)
	}
	return &Cache{directory: directory, bucket: bucket, client: client}, nil
}

// Ensure returns a local file for an artifact. The caller supplies the object
// key from trusted catalog metadata; it is never part of a public URL.
func (c *Cache) Ensure(ctx context.Context, artifactID, objectKey string) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	path := filepath.Join(c.directory, artifactID+".mbtiles")
	if info, err := os.Stat(path); err == nil && info.Size() > 0 {
		return path, nil
	}
	partial := path + ".part"
	_ = os.Remove(partial)
	response, err := c.client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(c.bucket), Key: aws.String(objectKey)})
	if err != nil {
		return "", fmt.Errorf("download converted artifact: %w", err)
	}
	defer response.Body.Close()
	file, err := os.OpenFile(partial, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o640)
	if err != nil {
		return "", err
	}
	_, copyErr := io.Copy(file, response.Body)
	closeErr := file.Close()
	if copyErr != nil {
		_ = os.Remove(partial)
		return "", copyErr
	}
	if closeErr != nil {
		_ = os.Remove(partial)
		return "", closeErr
	}
	if err := os.Rename(partial, path); err != nil {
		_ = os.Remove(partial)
		return "", err
	}
	return path, nil
}

func (c *Cache) Remove(artifactID string) error {
	return os.Remove(filepath.Join(c.directory, artifactID+".mbtiles"))
}
