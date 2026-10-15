Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-GeodataSecretValue([string]$Namespace, [string]$Name, [string]$Key) {
  $secret = kubectl -n $Namespace get secret $Name -o json | ConvertFrom-Json
  $encoded = $secret.data.$Key
  if ([string]::IsNullOrWhiteSpace($encoded)) {
    throw "Secret $Namespace/$Name does not contain $Key."
  }
  $value = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Secret $Namespace/$Name has an empty $Key."
  }
  return $value
}

# A Kubernetes Secret is namespace-scoped. The cache warmer lives in webgis to
# use its tile-data PVC, so copy only the values it needs from tile-server.
$database = Get-GeodataSecretValue 'tile-server' 'geodata-catalog-postgresql' 'database'
$username = Get-GeodataSecretValue 'tile-server' 'geodata-catalog-postgresql' 'username'
$password = Get-GeodataSecretValue 'tile-server' 'geodata-catalog-postgresql' 'password'
$accessKey = Get-GeodataSecretValue 'tile-server' 'geodata-worker-s3' 'access-key'
$secretKey = Get-GeodataSecretValue 'tile-server' 'geodata-worker-s3' 'secret-key'

kubectl -n webgis create secret generic geodata-cache-warmer-catalog `
  --from-literal="database=$database" `
  --from-literal="username=$username" `
  --from-literal="password=$password" `
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n webgis create secret generic geodata-cache-warmer-s3 `
  --from-literal="access-key=$accessKey" `
  --from-literal="secret-key=$secretKey" `
  --dry-run=client -o yaml | kubectl apply -f -

Remove-Variable database,username,password,accessKey,secretKey -ErrorAction SilentlyContinue
Write-Host 'Created the namespace-local Secrets required by the GeoData TileServer cache warmer.'
