Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-GeodataRandomBytes([int]$Length) {
  $geodataRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $geodataBytes = New-Object byte[] $Length
    $geodataRng.GetBytes($geodataBytes)
    return $geodataBytes
  } finally {
    $geodataRng.Dispose()
  }
}

function Assert-GeodataValue([string]$Name, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "$Name must not be empty. No credentials were applied."
  }
}

$geodataAdminKey = [BitConverter]::ToString((New-GeodataRandomBytes 10)).Replace('-', '')
$geodataAdminSecret = [Convert]::ToBase64String((New-GeodataRandomBytes 32))
$geodataUploadKey = [BitConverter]::ToString((New-GeodataRandomBytes 10)).Replace('-', '')
$geodataUploadSecret = [Convert]::ToBase64String((New-GeodataRandomBytes 32))
$geodataWorkerKey = [BitConverter]::ToString((New-GeodataRandomBytes 10)).Replace('-', '')
$geodataWorkerSecret = [Convert]::ToBase64String((New-GeodataRandomBytes 32))

Assert-GeodataValue 'Admin access key' $geodataAdminKey
Assert-GeodataValue 'Admin secret key' $geodataAdminSecret
Assert-GeodataValue 'Upload access key' $geodataUploadKey
Assert-GeodataValue 'Upload secret key' $geodataUploadSecret
Assert-GeodataValue 'Worker access key' $geodataWorkerKey
Assert-GeodataValue 'Worker secret key' $geodataWorkerSecret

$geodataS3Config = @{
  identities = @(
    @{
      name = 'bootstrap-admin'
      credentials = @(@{ accessKey = $geodataAdminKey; secretKey = $geodataAdminSecret })
      actions = @('Admin', 'Read', 'Write', 'List', 'Tagging')
    },
    @{
      name = 'geodata-upload'
      credentials = @(@{ accessKey = $geodataUploadKey; secretKey = $geodataUploadSecret })
      actions = @('Write', 'List')
      resources = @('buckets/geodata-raw/')
    }
    @{
      name = 'geodata-worker'
      credentials = @(@{ accessKey = $geodataWorkerKey; secretKey = $geodataWorkerSecret })
      actions = @('Read', 'Write', 'List')
      resources = @('buckets/geodata-raw/', 'buckets/geodata-derived/')
    }
  )
} | ConvertTo-Json -Depth 8 -Compress

$geodataS3ConfigFile = New-TemporaryFile
try {
  [System.IO.File]::WriteAllText($geodataS3ConfigFile.FullName, $geodataS3Config, (New-Object System.Text.UTF8Encoding($false)))
  kubectl -n storage create secret generic geodata-seaweed-s3-config --from-file="s3.json=$($geodataS3ConfigFile.FullName)" --dry-run=client -o yaml | kubectl apply -f -
  if ($LASTEXITCODE -ne 0) { throw 'Failed to apply SeaweedFS S3 configuration Secret.' }
} finally {
  Remove-Item -LiteralPath $geodataS3ConfigFile.FullName -Force -ErrorAction SilentlyContinue
}

kubectl -n storage create secret generic geodata-s3-bootstrap --from-literal="access-key=$geodataAdminKey" --from-literal="secret-key=$geodataAdminSecret" --dry-run=client -o yaml | kubectl apply -f -
if ($LASTEXITCODE -ne 0) { throw 'Failed to apply bootstrap S3 credentials Secret.' }

kubectl -n tile-server create secret generic geodata-upload-s3 --from-literal="access-key=$geodataUploadKey" --from-literal="secret-key=$geodataUploadSecret" --dry-run=client -o yaml | kubectl apply -f -
if ($LASTEXITCODE -ne 0) { throw 'Failed to apply upload S3 credentials Secret.' }
kubectl -n tile-server create secret generic geodata-worker-s3 --from-literal="access-key=$geodataWorkerKey" --from-literal="secret-key=$geodataWorkerSecret" --dry-run=client -o yaml | kubectl apply -f -
if ($LASTEXITCODE -ne 0) { throw 'Failed to apply worker S3 credentials Secret.' }

$geodataBootstrapSecret = kubectl -n storage get secret geodata-s3-bootstrap -o json | ConvertFrom-Json
$geodataBootstrapAccessKey = $geodataBootstrapSecret.data.'access-key'
$geodataBootstrapSecretKey = $geodataBootstrapSecret.data.'secret-key'
if ([string]::IsNullOrWhiteSpace($geodataBootstrapAccessKey) -or [string]::IsNullOrWhiteSpace($geodataBootstrapSecretKey) -or
    [Convert]::FromBase64String($geodataBootstrapAccessKey).Length -eq 0 -or [Convert]::FromBase64String($geodataBootstrapSecretKey).Length -eq 0) {
  throw 'Bootstrap S3 credentials Secret is empty after apply.'
}

Write-Host 'GeoData S3 credentials were rotated successfully. Restart SeaweedFS before creating the bucket bootstrap Job.'
