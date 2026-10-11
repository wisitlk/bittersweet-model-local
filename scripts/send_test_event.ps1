# Sends a signed sample LINE webhook to the Worker, so you can test without a phone.
# The body is signed with your channel secret exactly like LINE does, so it passes verification.
#
# WARNING: this talks to the LIVE Worker. It really calls Claude (costs money), counts against the
# rate limits, and may write real rows to your Google Sheet.
#
# Usage:
#   .\scripts\send_test_event.ps1 -Url "https://<worker>.workers.dev/webhook"     (asks for the secret, hidden)
#   .\scripts\send_test_event.ps1 -Url "..." -Text "hello"
#   .\scripts\send_test_event.ps1 -Url "..." -Verify        # empty events, like LINE's Verify button
#   .\scripts\send_test_event.ps1 -Url "..." -BadSignature  # should answer 401
#
# The channel secret is read with Read-Host -AsSecureString: it is never typed as an argument
# and it is not written anywhere.
# The replyToken in the sample is fake, so the Worker's reply to LINE fails with "Invalid reply token".
# That is expected: check `npx wrangler tail` to see the Worker run, and the CRM sheet for saved rows.

param(
    [Parameter(Mandatory = $true)][string]$Url,
    [string]$Text,
    [string]$UserId = "U_TEST_DEMO_USER_0001",
    [switch]$Verify,
    [switch]$BadSignature
)

$secure = Read-Host -Prompt "LINE channel secret (hidden)" -AsSecureString
$Secret = [System.Net.NetworkCredential]::new("", $secure).Password
if (-not $Secret) { throw "No secret entered." }

$samplePath = Join-Path $PSScriptRoot "..\test\fixtures\sample_webhook_event.json"
$payload = Get-Content -Raw -Encoding UTF8 $samplePath | ConvertFrom-Json

if ($Verify) {
    $payload.events = @()
} else {
    if ($Text) { $payload.events[0].message.text = $Text }
    $payload.events[0].source.userId = $UserId
    $payload.events[0].timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    # a unique id each time, because the Worker ignores event ids it has already seen
    $payload.events[0].webhookEventId = "01TEST" + [guid]::NewGuid().ToString("N").Substring(0, 20).ToUpper()
}

$json = $payload | ConvertTo-Json -Depth 10 -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

# signature = base64(HMAC-SHA256(raw body bytes, channel secret))
$hmac = New-Object System.Security.Cryptography.HMACSHA256
$hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($Secret)
$signature = [Convert]::ToBase64String($hmac.ComputeHash($bytes))
$Secret = $null
if ($BadSignature) { $signature = "AAAA" + $signature.Substring(4) }

try {
    $res = Invoke-WebRequest -Uri $Url -Method Post -Body $bytes -ContentType "application/json; charset=utf-8" `
        -Headers @{ "x-line-signature" = $signature } -UseBasicParsing
    Write-Host "HTTP $($res.StatusCode)"
    Write-Host $res.Content
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Write-Host "HTTP $code - $($_.Exception.Message)"
}
