# GeoData UI deployment

The UI is deployed in the `tile-server` namespace. It reuses WebGIS
authentication through the `/auth` reverse proxy.

Apply the UI manifests:

```powershell
kubectl apply -k deployment
```

The local ingress is available at `http://geodata.localhost`.

