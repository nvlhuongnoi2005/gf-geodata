param(
  [string]$Namespace = "tile-server",
  [string]$CacheWarmerNamespace = "webgis",
  [string]$User = "geodata",
  [string]$Database = "geodata"
)

$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $passwordBytes = New-Object byte[] 32
  $rng.GetBytes($passwordBytes)
} finally {
  $rng.Dispose()
}

$password = [Convert]::ToBase64String($passwordBytes)
kubectl -n $Namespace create secret generic geodata-catalog-postgresql `
  --from-literal="username=$User" `
  --from-literal="password=$password" `
  --from-literal="database=$Database" `
  --dry-run=client -o yaml | kubectl apply -f -

# The warmer runs alongside the existing WebGIS TileServer so it can mount the
# tile-data PVC. It needs the same catalog credentials, in its own namespace.
kubectl -n $CacheWarmerNamespace create secret generic geodata-cache-warmer-catalog `
  --from-literal="username=$User" `
  --from-literal="password=$password" `
  --from-literal="database=$Database" `
  --dry-run=client -o yaml | kubectl apply -f -

Write-Host "Created or updated GeoData catalog Secrets in $Namespace and $CacheWarmerNamespace. Store its password in your password manager; it is not printed here."
