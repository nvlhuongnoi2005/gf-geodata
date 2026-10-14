param(
  [string]$Namespace = "tile-server",
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

Write-Host "Created or updated geodata-catalog-postgresql in namespace $Namespace. Store its password in your password manager; it is not printed here."
