-- A GeoData MBTiles artifact is immutable and can safely back multiple map
-- versions. The old TileServer cache needed a one-dataset-per-release rule,
-- but it incorrectly prevents a release such as v1.0.1 from reusing the
-- already-ready MBTiles selected for v1.0.0.
DROP INDEX IF EXISTS map_release_artifacts_tile_server_dataset_unique;
