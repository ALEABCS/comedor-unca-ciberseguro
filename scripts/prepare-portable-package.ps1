$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$tempRoot = Join-Path $env:TEMP ('2027UNCAC-portable-' + [guid]::NewGuid().ToString('N'))
$portableBackups = @()
[System.IO.Directory]::CreateDirectory($tempRoot) | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Test-PortableEntry {
  param([string]$Name, [switch]$IncludeBuild)
  $portableName = $Name.Replace('\\', '/')
  $parts = $portableName -split '/'
  $baseName = [System.IO.Path]::GetFileName($portableName)
  $excludedDirectories = @('.git', 'node_modules', 'dist-server', 'coverage', 'logs')
  if (-not $IncludeBuild) { $excludedDirectories += 'dist' }
  $hasExcludedDirectory = $excludedDirectories | Where-Object { $parts -contains $_ }
  $isSecret = $baseName -eq '.env' -or ($baseName -like '.env.*' -and $baseName -ne '.env.example')
  $isGenerated = $baseName -like '*.tsbuildinfo' -or $baseName -like '*.log' -or $baseName -eq '.DS_Store'
  $isNestedArchive = $baseName -like '*.zip'
  return -not $hasExcludedDirectory -and -not $isSecret -and -not $isGenerated -and -not $isNestedArchive
}

foreach ($backup in Get-ChildItem -LiteralPath (Join-Path $root 'Backup') -Filter '*.zip' -File) {
  $cleanName = $backup.BaseName + '-portable.zip'
  $cleanPath = Join-Path $tempRoot $cleanName
  $source = [System.IO.Compression.ZipFile]::OpenRead($backup.FullName)
  $targetStream = [System.IO.File]::Open($cleanPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  $target = [System.IO.Compression.ZipArchive]::new($targetStream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
  try {
    foreach ($entry in $source.Entries) {
      if ($entry.FullName.EndsWith('/') -or -not (Test-PortableEntry $entry.FullName)) { continue }
      $entryStream = $entry.Open()
      $targetEntry = $target.CreateEntry($entry.FullName.Replace('\', '/'), [System.IO.Compression.CompressionLevel]::Optimal)
      $targetEntryStream = $targetEntry.Open()
      try { $entryStream.CopyTo($targetEntryStream) }
      finally { $targetEntryStream.Dispose(); $entryStream.Dispose() }
    }
  }
  finally { $target.Dispose(); $source.Dispose() }

  $check = [System.IO.Compression.ZipFile]::OpenRead($cleanPath)
  try {
    $unsafe = @($check.Entries | Where-Object {
      $name = $_.FullName
      $baseName = [System.IO.Path]::GetFileName($name)
      $parts = $name -split '/'
      $baseName -eq '.env' -or ($baseName -like '.env.*' -and $baseName -ne '.env.example') -or
        (@('.git', 'node_modules', 'dist', 'dist-server', 'coverage', 'logs') | Where-Object { $parts -contains $_ }) -or
        $baseName -like '*.zip' -or $baseName -like '*.tsbuildinfo' -or $baseName -like '*.log'
    })
    if ($unsafe.Count -gt 0) { throw "El respaldo portable $($backup.Name) contiene entradas locales o sensibles." }
    $portableBackups += [pscustomobject]@{ Path = $cleanPath; Name = $cleanName; Entries = $check.Entries.Count }
  }
  finally { $check.Dispose() }
}

$destination = Join-Path $root '2027UNCAC.new.zip'
if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Force }
$outer = [System.IO.Compression.ZipFile]::Open($destination, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -LiteralPath $root -File -Recurse -Force | ForEach-Object {
    $relative = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
    $parts = $relative -split '/'
    $skipBackupDirectory = $parts -contains 'Backup'
    $skipGenerated = $_.Name -like '*.tsbuildinfo' -or $_.Name -like '*.log' -or $_.Name -eq '.DS_Store'
    if ($skipBackupDirectory -or -not (Test-PortableEntry $relative -IncludeBuild) -or $skipGenerated -or $_.Name -eq '2027UNCAC.zip' -or $_.Name -eq '2027UNCAC.new.zip') { return }
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($outer, $_.FullName, $relative, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
  foreach ($portable in $portableBackups) {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($outer, $portable.Path, ('Backup/portable/' + $portable.Name), [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
}
finally { $outer.Dispose() }
$finalDestination = Join-Path $root '2027UNCAC.zip'
Move-Item -LiteralPath $destination -Destination $finalDestination -Force

[pscustomobject]@{
  Package = $finalDestination
  SanitizedBackups = $portableBackups.Count
  SanitizedBackupEntries = ($portableBackups | Measure-Object -Property Entries -Sum).Sum
  PackageBytes = (Get-Item -LiteralPath $finalDestination).Length
} | Format-List
