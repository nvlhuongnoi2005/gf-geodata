// Package directory reads identities from WebGIS. It deliberately never
// creates, copies, or updates identity records: WebGIS remains the source of
// truth for people and their organisations.
package directory

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	SubjectUser         = "user"
	SubjectOrganization = "organization"
)

var ErrNotFound = errors.New("directory subject not found")

// Subject contains only the presentation fields which an administrator needs
// to grant access. Passwords, sessions, scopes, and other auth internals are
// intentionally never selected.
type Subject struct {
	ID           string `json:"id"`
	Type         string `json:"type"`
	Name         string `json:"name"`
	Organization string `json:"organization,omitempty"`
	Detail       string `json:"detail,omitempty"`
}

type Directory struct{ pool *pgxpool.Pool }

func Open(ctx context.Context, databaseURL string) (*Directory, error) {
	pool, err := pgxpool.New(ctx, strings.TrimSpace(databaseURL))
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &Directory{pool: pool}, nil
}

func (d *Directory) Close() {
	if d != nil && d.pool != nil {
		d.pool.Close()
	}
}

func validType(kind string) bool { return kind == SubjectUser || kind == SubjectOrganization }

func (d *Directory) Search(ctx context.Context, kind, query string, limit int) ([]Subject, error) {
	if !validType(kind) {
		return nil, errors.New("unsupported directory subject type")
	}
	if limit < 1 || limit > 100 {
		limit = 25
	}
	query = strings.TrimSpace(query)
	if kind == SubjectOrganization {
		rows, err := d.pool.Query(ctx, `
SELECT organization, organization, count(*)::text
FROM users
WHERE status='ACTIVE'
  AND NULLIF(btrim(organization),'') IS NOT NULL
  AND ($1='' OR organization ILIKE '%' || $1 || '%')
GROUP BY organization
ORDER BY organization
LIMIT $2`, query, limit)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		items := make([]Subject, 0)
		for rows.Next() {
			var item Subject
			if err := rows.Scan(&item.ID, &item.Name, &item.Detail); err != nil {
				return nil, err
			}
			item.Type, item.Organization = SubjectOrganization, item.Name
			items = append(items, item)
		}
		return items, rows.Err()
	}
	rows, err := d.pool.Query(ctx, `
SELECT id::text, COALESCE(NULLIF(btrim(full_name),''),email), COALESCE(organization,''), email
FROM users
WHERE status='ACTIVE'
  AND ($1='' OR full_name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%' OR organization ILIKE '%' || $1 || '%')
ORDER BY COALESCE(NULLIF(btrim(full_name),''),email), email
LIMIT $2`, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Subject, 0)
	for rows.Next() {
		var item Subject
		if err := rows.Scan(&item.ID, &item.Name, &item.Organization, &item.Detail); err != nil {
			return nil, err
		}
		item.Type = SubjectUser
		items = append(items, item)
	}
	return items, rows.Err()
}

func (d *Directory) Subject(ctx context.Context, kind, id string) (Subject, error) {
	id = strings.TrimSpace(id)
	if id == "" || !validType(kind) {
		return Subject{}, ErrNotFound
	}
	if kind == SubjectOrganization {
		var name string
		err := d.pool.QueryRow(ctx, `SELECT organization FROM users WHERE status='ACTIVE' AND lower(btrim(organization))=lower(btrim($1)) GROUP BY organization LIMIT 1`, id).Scan(&name)
		if errors.Is(err, pgx.ErrNoRows) {
			return Subject{}, ErrNotFound
		}
		if err != nil {
			return Subject{}, err
		}
		return Subject{ID: name, Type: SubjectOrganization, Name: name, Organization: name}, nil
	}
	var item Subject
	err := d.pool.QueryRow(ctx, `SELECT id::text, COALESCE(NULLIF(btrim(full_name),''),email), COALESCE(organization,''), email FROM users WHERE id=$1 AND status='ACTIVE'`, id).Scan(&item.ID, &item.Name, &item.Organization, &item.Detail)
	if errors.Is(err, pgx.ErrNoRows) {
		return Subject{}, ErrNotFound
	}
	if err != nil {
		return Subject{}, err
	}
	item.Type = SubjectUser
	return item, nil
}

func (d *Directory) OrganizationForUser(ctx context.Context, userID string) (string, error) {
	var organization string
	err := d.pool.QueryRow(ctx, `SELECT COALESCE(NULLIF(btrim(organization),''),'') FROM users WHERE id=$1 AND status='ACTIVE'`, userID).Scan(&organization)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return organization, err
}
