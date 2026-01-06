# Vercel Deployment Script for Backend (PowerShell)

Write-Host "🚀 Deploying backend to Vercel..." -ForegroundColor Cyan
Write-Host ""

# Check if Vercel CLI is installed
try {
    $null = Get-Command vercel -ErrorAction Stop
    Write-Host "✅ Vercel CLI is installed" -ForegroundColor Green
} catch {
    Write-Host "❌ Vercel CLI is not installed." -ForegroundColor Red
    Write-Host "📦 Installing Vercel CLI..." -ForegroundColor Yellow
    npm install -g vercel
}

# Navigate to backend directory (if not already there)
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

Write-Host "📋 Current directory: $(Get-Location)" -ForegroundColor Cyan
Write-Host ""

# Check if user is logged in
try {
    $null = vercel whoami 2>&1
    Write-Host "✅ Logged in to Vercel" -ForegroundColor Green
} catch {
    Write-Host "🔐 Please login to Vercel..." -ForegroundColor Yellow
    vercel login
}

Write-Host ""
Write-Host "📦 Building project..." -ForegroundColor Cyan
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed! Please fix errors before deploying." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "🌐 Deploying to Vercel..." -ForegroundColor Cyan
vercel

Write-Host ""
Write-Host "✅ Deployment initiated!" -ForegroundColor Green
Write-Host ""
Write-Host "📝 Next steps:" -ForegroundColor Yellow
Write-Host "1. Set environment variables in Vercel dashboard:"
Write-Host "   - DATABASE_URL"
Write-Host "   - JWT_SECRET"
Write-Host "   - CORS_ORIGIN"
Write-Host "   - REDIS_URL (optional)"
Write-Host "   - REDIS_ENABLED (optional, set to 'false' if not using Redis)"
Write-Host ""
Write-Host "2. Deploy to production:"
Write-Host "   vercel --prod"
Write-Host ""
Write-Host "3. Test the deployment:"
Write-Host "   curl https://your-project.vercel.app/health"

