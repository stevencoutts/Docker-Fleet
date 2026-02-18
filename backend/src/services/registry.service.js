/**
 * Check container image update availability by comparing local digest with registry.
 * Supports Docker Hub and GHCR (and other OCI registries with same API).
 */
const https = require('https');
const logger = require('../config/logger');

/**
 * Parse image reference (e.g. "postgres:15-alpine", "ghcr.io/org/repo:tag") into components.
 * @returns {{ registry: string, path: string, tag: string, imageRef: string }}
 */
function parseImageRef(imageRef) {
  if (!imageRef || typeof imageRef !== 'string') {
    return { registry: '', path: '', tag: 'latest', imageRef: '' };
  }
  let tag = 'latest';
  const atIndex = imageRef.indexOf('@');
  const colonIndex = imageRef.lastIndexOf(':');
  if (atIndex !== -1) {
    // image@sha256:... - digest pinned, no update check needed in practice
    return { registry: '', path: '', tag: '', imageRef, digestPinned: true };
  }
  if (colonIndex !== -1) {
    const afterColon = imageRef.slice(colonIndex + 1);
    if (afterColon.includes('/') || afterColon.length > 64) {
      // port number or path segment, not a tag
    } else {
      tag = afterColon;
      imageRef = imageRef.slice(0, colonIndex);
    }
  }
  const parts = imageRef.split('/');
  let registry = 'registry-1.docker.io';
  let path = imageRef;
  if (parts.length >= 2 && (parts[0].includes('.') || parts[0].includes(':'))) {
    registry = parts[0];
    path = parts.slice(1).join('/');
  } else if (parts.length === 1 && parts[0] && !parts[0].includes('.')) {
    path = 'library/' + imageRef;
  }
  return { registry, path, tag, imageRef: imageRef + ':' + tag };
}

/**
 * Fetch Docker Hub token for pull scope.
 */
function getDockerHubToken(path) {
  const scope = `repository:${path}:pull`;
  const url = `https://auth.docker.io/token?service=registry.docker.io&scope=${encodeURIComponent(scope)}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.token || null);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Docker Hub token timeout')); });
  });
}

/**
 * Resolve registry host for HTTPS (Docker Hub uses registry-1.docker.io; ghcr.io is ghcr.io).
 */
function getRegistryHost(registry) {
  if (registry === 'registry-1.docker.io' || registry === 'docker.io') {
    return 'registry-1.docker.io';
  }
  return registry;
}

/**
 * HEAD manifest and return Docker-Content-Digest.
 * @param {string} registry - e.g. registry-1.docker.io or ghcr.io
 * @param {string} path - e.g. library/postgres or org/repo
 * @param {string} tag - e.g. 15-alpine
 * @param {string|null} token - Bearer token for Docker Hub
 * @returns {Promise<{ digest: string } | { error: string }>}
 */
function getRemoteDigest(registry, path, tag, token = null) {
  const host = getRegistryHost(registry);
  const isDockerHub = host === 'registry-1.docker.io';
  const pathEncoded = path.split('/').map(encodeURIComponent).join('/');
  const tagEncoded = encodeURIComponent(tag);
  const urlPath = `/v2/${pathEncoded}/manifests/${tagEncoded}`;

  const options = {
    hostname: host,
    path: urlPath,
    method: 'HEAD',
    headers: {
      Accept: 'application/vnd.docker.distribution.manifest.v2+json',
    },
  };
  if (token) {
    options.headers.Authorization = `Bearer ${token}`;
  }

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      if (res.statusCode === 401 && isDockerHub && res.headers['www-authenticate']) {
        req.destroy();
        getDockerHubToken(path).then((t) => {
          getRemoteDigest(registry, path, tag, t).then(resolve).catch((e) => resolve({ error: e.message }));
        }).catch((e) => resolve({ error: e.message }));
        return;
      }
      const digest = res.headers['docker-content-digest'];
      if (digest) {
        resolve({ digest });
      } else {
        resolve({ error: 'No Docker-Content-Digest in response' });
      }
    });
    req.on('error', (err) => resolve({ error: err.message }));
    req.setTimeout(15000, () => {
      req.destroy();
      resolve({ error: 'Registry request timeout' });
    });
    req.end();
  });
}

/**
 * Check if a container's image has an update available by comparing local digest to registry.
 * @param {object} opts - { localDigest, imageRef } where imageRef is e.g. "postgres:15-alpine"
 * @returns {Promise<{ updateAvailable: boolean, remoteDigest?: string, error?: string }>}
 */
async function checkUpdateAvailable(opts) {
  const { localDigest, imageRef } = opts;
  if (!localDigest || !imageRef) {
    return { updateAvailable: false, error: 'Missing localDigest or imageRef' };
  }
  const parsed = parseImageRef(imageRef);
  if (parsed.digestPinned) {
    return { updateAvailable: false };
  }
  if (!parsed.registry || !parsed.path) {
    return { updateAvailable: false, error: 'Could not parse image reference' };
  }

  let token = null;
  if (getRegistryHost(parsed.registry) === 'registry-1.docker.io') {
    try {
      token = await getDockerHubToken(parsed.path);
    } catch (e) {
      logger.debug('Docker Hub token failed:', e.message);
    }
  }

  const result = await getRemoteDigest(parsed.registry, parsed.path, parsed.tag, token);
  if (result.error) {
    return { updateAvailable: false, error: result.error };
  }
  const remoteDigest = result.digest;
  const localNormalized = (localDigest || '').replace(/^sha256:/i, '');
  const remoteNormalized = (remoteDigest || '').replace(/^sha256:/i, '');
  const updateAvailable = localNormalized !== remoteNormalized;
  return { updateAvailable, remoteDigest };
}

module.exports = {
  parseImageRef,
  getRemoteDigest,
  checkUpdateAvailable,
};
