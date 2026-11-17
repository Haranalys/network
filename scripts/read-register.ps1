param([Parameter(Mandatory=$true)][string]$InputPath, [Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($InputPath)
function Read-XmlEntry([string]$name) {
  $entry = $archive.GetEntry($name)
  if (!$entry) { throw "Missing XLSX entry: $name" }
  $reader = [IO.StreamReader]::new($entry.Open())
  try { return [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
}
try {
  $workbook = Read-XmlEntry 'xl/workbook.xml'
  $sheetInfo = $workbook.SelectNodes('//*[local-name()="sheet"]') | Where-Object { $_.name -eq 'Salongsregister' }
  if (!$sheetInfo) { throw 'Missing sheet Salongsregister' }
  $relations = Read-XmlEntry 'xl/_rels/workbook.xml.rels'
  $relationId = $sheetInfo.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
  $target = ($relations.DocumentElement.ChildNodes | Where-Object { $_.Id -eq $relationId }).Target
  $entryPath = if ($target.StartsWith('/')) { $target.TrimStart('/') } else { 'xl/' + $target }
  $sheet = Read-XmlEntry $entryPath
  $shared = @()
  if ($archive.GetEntry('xl/sharedStrings.xml')) {
    $strings = Read-XmlEntry 'xl/sharedStrings.xml'
    $shared = @($strings.SelectNodes('//*[local-name()="si"]') | ForEach-Object { ($_.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join '' })
  }
  $headers = [ordered]@{}
  $records = @()
  foreach ($row in $sheet.SelectNodes('//*[local-name()="sheetData"]/*[local-name()="row"]')) {
    $cells = @{}
    foreach ($cell in $row.ChildNodes) {
      if ($cell.SelectSingleNode('*[local-name()="f"]')) { throw "Formula not supported: $($cell.r)" }
      $valueNode = $cell.SelectSingleNode('*[local-name()="v"]')
      $value = if ($cell.t -eq 'inlineStr') { ($cell.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join '' }
        elseif ($cell.t -eq 's' -and $valueNode) { $shared[[int]$valueNode.InnerText] }
        elseif ($valueNode) { $valueNode.InnerText } else { $null }
      $cells[($cell.r -replace '\d', '')] = if ([string]::IsNullOrWhiteSpace($value)) { $null } else { $value }
    }
    if (!$headers.Count) {
      if ($cells['A'] -eq 'ID' -and $cells['B'] -eq 'Salong / verksamhet') {
        foreach ($column in ($cells.Keys | Sort-Object)) { if ($cells[$column]) { $headers[$column] = $cells[$column] } }
      }
      continue
    }
    if (!$cells['A'] -and !$cells['B']) { continue }
    $fields = [ordered]@{}
    foreach ($column in $headers.Keys) { $fields[$headers[$column]] = $cells[$column] }
    $records += [ordered]@{ row = [int]$row.r; fields = $fields }
  }
  if (!$records.Count) { throw 'No register rows found' }
  $snapshot = [ordered]@{
    file = [IO.Path]::GetFileName($InputPath)
    sha256 = (Get-FileHash -LiteralPath $InputPath -Algorithm SHA256).Hash.ToLowerInvariant()
    sheet = 'Salongsregister'
    rows = $records
  }
  [IO.File]::WriteAllText($OutputPath, ($snapshot | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
} finally { $archive.Dispose() }
