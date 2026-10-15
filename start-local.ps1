$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$rootPrefix = $root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 5500)
$mimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.ico'  = 'image/x-icon'
}

try {
    $listener.Start()
    Write-Host 'Serving this folder at http://127.0.0.1:5500/fronted.html'
    Write-Host 'Keep this window open. Press Ctrl+C to stop the server.'

    while ($listener.Server.IsBound) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
            $requestLine = $reader.ReadLine()
            if (-not $requestLine) { continue }
            $headers = @{}
            while ($true) {
                $headerLine = $reader.ReadLine()
                if ([string]::IsNullOrEmpty($headerLine)) { break }
                $separator = $headerLine.IndexOf(':')
                if ($separator -gt 0) {
                    $headers[$headerLine.Substring(0, $separator).Trim()] = $headerLine.Substring($separator + 1).Trim()
                }
            }

            $parts = $requestLine.Split(' ', 3)
            $method = $parts[0]
            $requestPath = if ($parts.Length -gt 1) { $parts[1].Split('?')[0] } else { '/' }
            if ($requestPath -eq '/') { $requestPath = '/fronted.html' }
            $relativePath = [Uri]::UnescapeDataString($requestPath.TrimStart('/')).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
            $filePath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $relativePath))

            $status = '200 OK'
            $body = [byte[]]@()
            $contentType = 'application/octet-stream'
            if (-not $filePath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or -not [System.IO.File]::Exists($filePath)) {
                $status = '404 Not Found'
                $body = [System.Text.Encoding]::UTF8.GetBytes('Not found')
                $contentType = 'text/plain; charset=utf-8'
            } elseif ($method -notin @('GET', 'HEAD')) {
                $status = '405 Method Not Allowed'
                $body = [System.Text.Encoding]::UTF8.GetBytes('Method not allowed')
                $contentType = 'text/plain; charset=utf-8'
            } else {
                $extension = [System.IO.Path]::GetExtension($filePath).ToLowerInvariant()
                if ($mimeTypes.ContainsKey($extension)) { $contentType = $mimeTypes[$extension] }
                $body = [System.IO.File]::ReadAllBytes($filePath)
            }

            $header = "HTTP/1.1 $status`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nConnection: close`r`nX-Content-Type-Options: nosniff`r`n`r`n"
            $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
            $stream.Write($headerBytes, 0, $headerBytes.Length)
            if ($method -ne 'HEAD' -and $body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
            $stream.Flush()
        } catch {
            Write-Warning "Could not serve request: $($_.Exception.Message)"
        } finally {
            if ($client) { $client.Close() }
        }
    }
} catch {
    Write-Error "Could not start the local server on port 5500. Close any process already using that port, then retry. $($_.Exception.Message)"
    exit 1
} finally {
    $listener.Stop()
}
