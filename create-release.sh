#!/bin/bash

# DockerFleet Manager Release Script
# This script helps create a v1.0.0 release

set -e

VERSION="1.0.0"
TAG="v${VERSION}"

echo "🚀 Creating DockerFleet Manager ${TAG} Release"
echo "================================================"

# Check if we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "⚠️  Warning: You're not on the main branch (currently on: $CURRENT_BRANCH)"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo "❌ Error: You have uncommitted changes. Please commit or stash them first."
    exit 1
fi

# Check if tag already exists
if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo "⚠️  Tag $TAG already exists!"
    read -p "Delete and recreate? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git tag -d "$TAG"
        git push origin ":refs/tags/$TAG" 2>/dev/null || true
    else
        exit 1
    fi
fi

# Ensure we're up to date
echo "📥 Pulling latest changes..."
git pull origin main

# Create annotated tag
echo "🏷️  Creating git tag ${TAG}..."
git tag -a "$TAG" -m "Release version ${VERSION} - Initial stable release"

# Push tag to GitHub
echo "📤 Pushing tag to GitHub..."
git push origin "$TAG"

# Build Docker images
echo "🐳 Building Docker images..."
docker-compose build

# Tag Docker images
# Docker Compose names images based on directory name, so we need to find the actual image names
echo "🏷️  Tagging Docker images..."
BACKEND_IMAGE=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "backend.*latest" | head -1)
FRONTEND_IMAGE=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "frontend.*latest" | head -1)

if [ -z "$BACKEND_IMAGE" ] || [ -z "$FRONTEND_IMAGE" ]; then
    echo "⚠️  Warning: Could not find built images. Trying to build first..."
    docker-compose build
    BACKEND_IMAGE=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "backend.*latest" | head -1)
    FRONTEND_IMAGE=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "frontend.*latest" | head -1)
fi

if [ -z "$BACKEND_IMAGE" ] || [ -z "$FRONTEND_IMAGE" ]; then
    echo "❌ Error: Could not find built images. Please run 'docker-compose build' first."
    exit 1
fi

# Extract base name without tag
BACKEND_BASE=$(echo $BACKEND_IMAGE | cut -d: -f1)
FRONTEND_BASE=$(echo $FRONTEND_IMAGE | cut -d: -f1)

# Tag with standardized dockerfleet-manager names and version
echo "   Found images: ${BACKEND_IMAGE}, ${FRONTEND_IMAGE}"
echo "   Tagging with dockerfleet-manager-* naming convention..."

# Tag with version using standardized names
docker tag ${BACKEND_IMAGE} dockerfleet-manager-backend:${VERSION} 2>/dev/null || true
docker tag ${FRONTEND_IMAGE} dockerfleet-manager-frontend:${VERSION} 2>/dev/null || true
docker tag ${BACKEND_IMAGE} dockerfleet-manager-backend:${TAG} 2>/dev/null || true
docker tag ${FRONTEND_IMAGE} dockerfleet-manager-frontend:${TAG} 2>/dev/null || true

# Also tag with original names for backward compatibility
docker tag ${BACKEND_IMAGE} ${BACKEND_BASE}:${VERSION} 2>/dev/null || true
docker tag ${FRONTEND_IMAGE} ${FRONTEND_BASE}:${VERSION} 2>/dev/null || true
docker tag ${BACKEND_IMAGE} ${BACKEND_BASE}:${TAG} 2>/dev/null || true
docker tag ${FRONTEND_IMAGE} ${FRONTEND_BASE}:${TAG} 2>/dev/null || true

echo "   ✅ Tagged: dockerfleet-manager-backend:${VERSION}, dockerfleet-manager-frontend:${VERSION}"

echo ""
echo "✅ Release preparation complete!"
echo ""
echo "Next steps:"
echo "1. Review the tag: git show ${TAG}"
echo "2. Create GitHub release:"
echo "   - Go to https://github.com/stevencoutts/Docker-Fleet/releases/new"
echo "   - Select tag: ${TAG}"
echo "   - Add release notes (see RELEASE.md for template)"
echo "   - Or use GitHub CLI: gh release create ${TAG} --title \"${TAG} - Initial Stable Release\" --notes-file RELEASE.md"
echo ""
echo "3. (Optional) Push Docker images to registry:"
echo "   docker push your-registry/dockerfleet-manager-backend:${VERSION}"
echo "   docker push your-registry/dockerfleet-manager-frontend:${VERSION}"
echo ""
