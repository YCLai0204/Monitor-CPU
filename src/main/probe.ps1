# probe.ps1 — 常駐取樣程序，每隔 IntervalMs 輸出一行 JSON 給 Electron 主程序讀取。
#
# 設計目標：在「大部分的 Windows 電腦」上都能跑，因此
#   * 只用 Windows 內建的東西（CIM/WMI、效能計數器），不裝任何驅動或套件
#   * 效能計數器名稱會依系統語言在地化，所以用登錄檔把英文名字翻成當地名字
#   * 任何一項抓不到就回 $null，讓前端顯示 N/A，絕不讓整支程式掛掉
param(
    [int]$IntervalMs = 2000
)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# ---------------------------------------------------------------- 效能計數器在地化

$script:CounterMap = $null

function Initialize-CounterMap {
    # Perflib\009 永遠是英文；Perflib\CurrentLanguage 是目前系統語言。
    # 兩邊都是 [索引, 名稱, 索引, 名稱, ...] 的字串陣列，靠索引對起來即可。
    $eng = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Perflib\009' -Name Counter).Counter
    $loc = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Perflib\CurrentLanguage' -Name Counter).Counter
    if (-not $eng) { return }

    $idToLoc = @{}
    if ($loc) {
        for ($i = 0; $i -lt ($loc.Count - 1); $i += 2) { $idToLoc[$loc[$i]] = $loc[$i + 1] }
    }

    $map = @{}
    for ($i = 0; $i -lt ($eng.Count - 1); $i += 2) {
        $id = $eng[$i]
        $name = $eng[$i + 1]
        if ([string]::IsNullOrWhiteSpace($name)) { continue }
        $key = $name.ToLowerInvariant()
        if (-not $map.ContainsKey($key)) {
            if ($idToLoc.ContainsKey($id)) { $map[$key] = $idToLoc[$id] } else { $map[$key] = $name }
        }
    }
    $script:CounterMap = $map
}

function Get-LocalCounterName([string]$EnglishName) {
    if ($script:CounterMap) {
        $key = $EnglishName.ToLowerInvariant()
        if ($script:CounterMap.ContainsKey($key)) { return $script:CounterMap[$key] }
    }
    return $EnglishName
}

# ---------------------------------------------------------------- 能力偵測（只做一次）

Initialize-CounterMap

$hasNvidiaSmi = $null -ne (Get-Command nvidia-smi -ErrorAction SilentlyContinue)

# LibreHardwareMonitor / OpenHardwareMonitor 如果正在背景執行，會開一個 WMI namespace，
# 那是 Windows 上唯一能穩定拿到桌機 CPU/GPU 溫度的免驅動方式。
$hwmNamespace = $null
foreach ($ns in @('root/LibreHardwareMonitor', 'root/OpenHardwareMonitor')) {
    if (Get-CimInstance -Namespace $ns -ClassName Sensor -ErrorAction SilentlyContinue | Select-Object -First 1) {
        $hwmNamespace = $ns
        break
    }
}

$gpuCounterPath = '\{0}(*)\{1}' -f (Get-LocalCounterName 'GPU Engine'), (Get-LocalCounterName 'Utilization Percentage')
$gpuCounterWorks = $true

# ---------------------------------------------------------------- 各項取樣

function Get-CpuTemperature {
    # 1) LibreHardwareMonitor / OpenHardwareMonitor
    if ($hwmNamespace) {
        $s = Get-CimInstance -Namespace $hwmNamespace -ClassName Sensor -ErrorAction SilentlyContinue |
            Where-Object { $_.SensorType -eq 'Temperature' -and $_.Identifier -like '*cpu*' }
        if ($s) {
            $pkg = $s | Where-Object { $_.Name -match 'Package|Total|CPU' } | Select-Object -First 1
            if (-not $pkg) { $pkg = $s | Select-Object -First 1 }
            if ($pkg) { return [math]::Round([double]$pkg.Value, 1) }
        }
    }

    # 2) ACPI 熱區。筆電通常有，桌機常常沒有 —— 沒有就回 null。
    $tz = Get-CimInstance -Namespace 'root/wmi' -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue
    if ($tz) {
        $k = ($tz | Measure-Object -Property CurrentTemperature -Maximum).Maximum
        if ($k -gt 0) {
            $c = ($k / 10.0) - 273.15
            if ($c -gt 0 -and $c -lt 150) { return [math]::Round($c, 1) }
        }
    }

    return $null
}

function Get-GpuFromNvidiaSmi {
    if (-not $hasNvidiaSmi) { return $null }
    $raw = & nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,name --format=csv,noheader,nounits 2>$null
    if (-not $raw) { return $null }
    $line = @($raw)[0]
    if (-not $line) { return $null }
    $parts = $line -split ','
    if ($parts.Count -lt 3) { return $null }
    return [ordered]@{
        load = [double]($parts[0].Trim())
        temp = [double]($parts[1].Trim())
        name = $parts[2].Trim()
    }
}

function Get-GpuFromHwm {
    if (-not $hwmNamespace) { return $null }
    $sensors = Get-CimInstance -Namespace $hwmNamespace -ClassName Sensor -ErrorAction SilentlyContinue |
        Where-Object { $_.Identifier -like '*gpu*' }
    if (-not $sensors) { return $null }

    $load = $sensors | Where-Object { $_.SensorType -eq 'Load' -and $_.Name -match 'Core|GPU' } | Select-Object -First 1
    $temp = $sensors | Where-Object { $_.SensorType -eq 'Temperature' -and $_.Name -match 'Core|GPU' } | Select-Object -First 1
    if (-not $load -and -not $temp) { return $null }

    $result = [ordered]@{ load = $null; temp = $null; name = $null }
    if ($load) { $result.load = [math]::Round([double]$load.Value, 1) }
    if ($temp) { $result.temp = [math]::Round([double]$temp.Value, 1) }
    return $result
}

function Get-GpuLoadFromCounter {
    # Windows 10/11 內建的 GPU Engine 計數器，不分廠牌（NVIDIA / AMD / Intel 都有）。
    # 每個 engine 各自算一條，把同一種 engtype 加總後取最大值，數字才會接近工作管理員。
    if (-not $gpuCounterWorks) { return $null }
    $samples = (Get-Counter -Counter $gpuCounterPath -SampleInterval 1 -MaxSamples 2 -ErrorAction SilentlyContinue).CounterSamples
    if (-not $samples) {
        $script:gpuCounterWorks = $false
        return $null
    }

    $byType = @{}
    foreach ($s in $samples) {
        if ($s.InstanceName -match 'engtype_(\w+)') {
            $type = $Matches[1]
            if (-not $byType.ContainsKey($type)) { $byType[$type] = 0.0 }
            $byType[$type] += [double]$s.CookedValue
        }
    }
    if ($byType.Count -eq 0) { return $null }

    $max = ($byType.Values | Measure-Object -Maximum).Maximum
    if ($max -lt 0) { $max = 0 }
    if ($max -gt 100) { $max = 100 }
    return [math]::Round($max, 1)
}

function Get-GpuName {
    $c = Get-CimInstance -ClassName Win32_VideoController -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -and $_.Name -notmatch 'Remote|Basic Display|Meta|Virtual' } |
        Select-Object -First 1
    if ($c) { return $c.Name }
    return $null
}

# ---------------------------------------------------------------- 主迴圈

$cachedGpuName = Get-GpuName
$cpuName = (Get-CimInstance -ClassName Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1).Name

while ($true) {
    $out = [ordered]@{
        cpuTemp = $null
        cpuName = $cpuName
        gpuLoad = $null
        gpuTemp = $null
        gpuName = $cachedGpuName
        source  = 'none'
    }

    $out.cpuTemp = Get-CpuTemperature

    $nv = Get-GpuFromNvidiaSmi
    if ($nv) {
        $out.gpuLoad = $nv.load
        $out.gpuTemp = $nv.temp
        if ($nv.name) { $out.gpuName = $nv.name }
        $out.source = 'nvidia-smi'
    }
    else {
        $hwm = Get-GpuFromHwm
        if ($hwm) {
            $out.gpuLoad = $hwm.load
            $out.gpuTemp = $hwm.temp
            $out.source = 'hwmonitor'
        }
        if ($null -eq $out.gpuLoad) {
            $out.gpuLoad = Get-GpuLoadFromCounter
            if ($null -ne $out.gpuLoad) { $out.source = 'perfcounter' }
        }
    }

    try { [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress -Depth 3)) } catch {}
    try { [Console]::Out.Flush() } catch {}

    Start-Sleep -Milliseconds $IntervalMs
}
