```powershell
$ErrorActionPreference = 'Stop'
$name = 'cloud-first-nginx'
$image = 'nginxdemos/hello'

docker info > $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Engine недоступний.' }

docker pull $image
if ($LASTEXITCODE -ne 0) { throw 'Не вдалося завантажити образ.' }

docker images

docker run -d --name $name -p 8080:80 $image
if ($LASTEXITCODE -ne 0) { throw 'Не вдалося запустити контейнер.' }

docker ps

Start-Sleep -Seconds 3
curl.exe --fail --silent --show-error http://localhost:8080
if ($LASTEXITCODE -ne 0) { throw 'Застосунок не відповів.' }

docker logs $name

docker stop $name
if ($LASTEXITCODE -ne 0) { throw 'Не вдалося зупинити контейнер.' }

docker rm $name
if ($LASTEXITCODE -ne 0) { throw 'Не вдалося видалити контейнер.' }

docker ps -a
```