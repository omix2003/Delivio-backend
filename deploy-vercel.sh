#!/bin/bash
# Vercel Deployment Script for Backend

echo "🚀 Deploying backend to Vercel..."
echo ""

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI is not installed."
    echo "📦 Installing Vercel CLI..."
    npm install -g vercel
fi

# Navigate to backend directory (if not already there)
cd "$(dirname "$0")"

echo "📋 Current directory: $(pwd)"
echo ""

# Check if user is logged in
if ! vercel whoami &> /dev/null; then
    echo "🔐 Please login to Vercel..."
    vercel login
fi

echo ""
echo "📦 Building project..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed! Please fix errors before deploying."
    exit 1
fi

echo ""
echo "🌐 Deploying to Vercel..."
vercel

echo ""
echo "✅ Deployment initiated!"
echo ""
echo "📝 Next steps:"
echo "1. Set environment variables in Vercel dashboard:"
echo "   - DATABASE_URL"
echo "   - JWT_SECRET"
echo "   - CORS_ORIGIN"
echo "   - REDIS_URL (optional)"
echo "   - REDIS_ENABLED (optional, set to 'false' if not using Redis)"
echo ""
echo "2. Deploy to production:"
echo "   vercel --prod"
echo ""
echo "3. Test the deployment:"
echo "   curl https://your-project.vercel.app/health"

