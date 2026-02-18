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
 * Make HEAD or GET manifest request and return digest or null/error.
 */
function doManifestRequest(host, urlPath, token, isDockerHub, method) {
  const options = {
    hostname: host,
    path: urlPath,
    method,
    headers: {
      Accept: 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json',
    },
  };
  if (token) {
    options.headers.Authorization = `Bearer ${token}`;
  }

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      if (res.statusCode === 401 && isDockerHub && res.headers['www-authenticate']) {
        req.destroy();
        resolve(null);
        return;
      }
      const digest = res.headers['docker-content-digest'];
      if (digest) {
        res.resume();
        resolve({ digest });
        return;
      }
      if (method === 'HEAD') {
        resolve(null);
        return;
      }
      res.resume();
      resolve({ error: 'No Docker-Content-Digest in response' });
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
 * HEAD manifest (then GET if needed) and return Docker-Content-Digest.
 * Some registries (e.g. ghcr.io) only return the digest on GET.
 */
function getRemoteDigest(registry, path, tag, token = null) {
  const host = getRegistryHost(registry);
  const isDockerHub = host === 'registry-1.docker.io';
  const pathEncoded = path.split('/').map(encodeURIComponent).join('/');
  const tagEncoded = encodeURIComponent(tag);
  const urlPath = `/v2/${pathEncoded}/manifests/${tagEncoded}`;

  return doManifestRequest(host, urlPath, token, isDockerHub, 'HEAD').then((result) => {
    if (result && result.error) return result;
    if (result && result.digest) return result;
    if (result === null && isDockerHub) {
      return getDockerHubToken(path).then((t) =>
        getRemoteDigest(registry, path, tag, t)
      ).catch((e) => ({ error: e.message }));
    }
    return doManifestRequest(host, urlPath, token, isDockerHub, 'GET');
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

/**
 * Parse version from a tag. Supports:
 * - LinuxServer: 4.1.0-r0-ls330, amd64-4.1.0-r0-ls330
 * - GHCR timestamp: 0.19.0-20260217191538, 0.19.0-20260217191538-amd64
 * Returns { major, minor, patch, r, ls } or null for non-version tags (e.g. latest, dev).
 */
function parseVersionFromTag(tag) {
  if (!tag || typeof tag !== 'string') return null;
  const t = tag.trim();
  if (t === 'latest' || t === '' || t === 'dev') return null;
  // LinuxServer: X.Y.Z-rN or X.Y.Z-rN-lsNNN (optionally with arch prefix)
  let m = t.match(/(\d+)\.(\d+)\.(\d+)-r(\d+)(?:-ls(\d+))?$/);
  if (m) {
    return {
      major: parseInt(m[1], 10),
      minor: parseInt(m[2], 10),
      patch: parseInt(m[3], 10),
      r: parseInt(m[4], 10),
      ls: m[5] ? parseInt(m[5], 10) : 0,
    };
  }
  // GHCR timestamp style: X.Y.Z-YYYYMMDDHHMMSS or X.Y.Z-YYYYMMDDHHMMSS-arch
  m = t.match(/(\d+)\.(\d+)\.(\d+)-(\d{8,})(?:-|$)/);
  if (m) {
    return {
      major: parseInt(m[1], 10),
      minor: parseInt(m[2], 10),
      patch: parseInt(m[3], 10),
      r: 0,
      ls: parseInt(m[4], 10), // timestamp compared numerically
    };
  }
  return null;
}

/**
 * Parse version from a string (tag or label), e.g. "4.0.3-r0-ls168", "4.0.3", "0.19.0-20260217164428".
 * Same return shape as parseVersionFromTag; for "X.Y.Z" only, r and ls are 0.
 */
function parseVersionFromString(s) {
  if (!s || typeof s !== 'string') return null;
  const raw = s.trim();
  const v = parseVersionFromTag(raw);
  if (v) return v;
  const m = raw.match(/^(\d+)\.(\d+)\.(\d+)(?:-r(\d+))?(?:-ls(\d+))?$/);
  if (m) {
    return {
      major: parseInt(m[1], 10),
      minor: parseInt(m[2], 10),
      patch: parseInt(m[3], 10),
      r: m[4] ? parseInt(m[4], 10) : 0,
      ls: m[5] ? parseInt(m[5], 10) : 0,
    };
  }
  const m2 = raw.match(/^(\d+)\.(\d+)\.(\d+)-(\d{8,})$/);
  if (m2) {
    return {
      major: parseInt(m2[1], 10),
      minor: parseInt(m2[2], 10),
      patch: parseInt(m2[3], 10),
      r: 0,
      ls: parseInt(m2[4], 10),
    };
  }
  return null;
}

/**
 * Extract a clean version string from label text.
 * Supports LinuxServer (4.1.0-r0-ls330) and GHCR timestamp (0.19.0-20260217164428) style.
 */
function extractVersionFromLabel(labelValue) {
  if (!labelValue || typeof labelValue !== 'string') return null;
  const raw = labelValue.trim();
  const m = raw.match(/(\d+\.\d+\.\d+-r\d+(?:-ls\d+)?)|(\d+\.\d+\.\d+-\d{8,})/);
  return m ? (m[1] || m[2]) : raw;
}

/**
 * Compare two parsed version objects. Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
function compareVersionParts(a, b) {
  if (!a || !b) return 0;
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  if (a.r !== b.r) return a.r < b.r ? -1 : 1;
  if (a.ls !== b.ls) return a.ls < b.ls ? -1 : 1;
  return 0;
}

/**
 * From a list of tags, return the newest by version (LinuxServer-style X.Y.Z-rN-lsNNN).
 * Prefers a tag without arch prefix (e.g. 4.1.0-r0-ls330 over amd64-4.1.0-r0-ls330) when equal.
 * @returns {{ tag: string, version: object } | null}
 */
function getNewestVersionTag(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  const withVersion = tags
    .map((tag) => ({ tag, parsed: parseVersionFromTag(tag) }))
    .filter((x) => x.parsed);
  if (withVersion.length === 0) return null;
  withVersion.sort((a, b) => -compareVersionParts(a.parsed, b.parsed)); // newest first
  const best = withVersion[0];
  const sameVersion = withVersion.filter((x) => compareVersionParts(x.parsed, best.parsed) === 0);
  const preferNoPrefix = sameVersion.find((x) => !/^[a-z0-9]+-[\d.]+/.test(x.tag) && !/-[a-z0-9]+$/.test(x.tag));
  const chosen = preferNoPrefix || best;
  return { tag: chosen.tag, version: chosen.parsed };
}

/**
 * Fetch GHCR token for pull scope (for public images, anonymous pull).
 */
function getGHCRToken(path) {
  const scope = `repository:${path}:pull`;
  const url = `https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(scope)}`;
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
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('GHCR token timeout')); });
  });
}

const TAGS_PAGE_SIZE = 500;
const TAGS_MAX_TOTAL = 5000;

/**
 * Fetch one page of tags (Docker Registry V2 tags/list). Use last= for next page.
 */
function listTagsPage(host, pathEncoded, token, last = null) {
  let urlPath = `/v2/${pathEncoded}/tags/list?n=${TAGS_PAGE_SIZE}`;
  if (last) urlPath += `&last=${encodeURIComponent(last)}`;
  const options = {
    hostname: host,
    path: urlPath,
    method: 'GET',
    headers: { Accept: 'application/json' },
  };
  if (token) {
    options.headers.Authorization = `Bearer ${token}`;
  }
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const tags = Array.isArray(json.tags) ? json.tags : [];
          resolve({ tags });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Registry request timeout')); });
    req.end();
  });
}

/**
 * List tags for a repository (Docker Hub and GHCR), with pagination so we get all tags.
 * @returns {Promise<{ tags: string[] } | { error: string }>}
 */
function listTags(registry, path, token = null) {
  const host = getRegistryHost(registry);
  const isDockerHub = host === 'registry-1.docker.io';
  const pathEncoded = path.split('/').map(encodeURIComponent).join('/');

  /** Paginate: collect all tags by following last= until we get a short page or hit limit. */
  function fetchAllPages(t) {
    const allTags = [];
    function nextPage(last = null) {
      return listTagsPage(host, pathEncoded, t, last).then(({ tags }) => {
        allTags.push(...tags);
        if (tags.length >= TAGS_PAGE_SIZE && allTags.length < TAGS_MAX_TOTAL && tags.length > 0) {
          return nextPage(tags[tags.length - 1]);
        }
        return { tags: allTags };
      });
    }
    return nextPage();
  }

  return new Promise((resolve) => {
    const req = https.request({
      hostname: host,
      path: `/v2/${pathEncoded}/tags/list?n=${TAGS_PAGE_SIZE}`,
      method: 'GET',
      headers: Object.assign({ Accept: 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {}),
    }, (res) => {
      if (res.statusCode === 401 && res.headers['www-authenticate']) {
        res.resume();
        const onToken = (t) => fetchAllPages(t).then(resolve).catch((e) => resolve({ error: e.message }));
        if (isDockerHub) {
          getDockerHubToken(path).then(onToken).catch((e) => resolve({ error: e.message }));
        } else {
          getGHCRToken(path).then(onToken).catch((e) => resolve({ error: e.message }));
        }
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const first = Array.isArray(json.tags) ? json.tags : [];
          const allTags = [...first];
          function nextPage(last) {
            return listTagsPage(host, pathEncoded, token, last).then(({ tags }) => {
              allTags.push(...tags);
              if (tags.length >= TAGS_PAGE_SIZE && allTags.length < TAGS_MAX_TOTAL && tags.length > 0) {
                return nextPage(tags[tags.length - 1]);
              }
              resolve({ tags: allTags });
            }).catch((e) => resolve({ error: e.message }));
          }
          if (first.length >= TAGS_PAGE_SIZE && first.length > 0 && allTags.length < TAGS_MAX_TOTAL) {
            nextPage(first[first.length - 1]);
          } else {
            resolve({ tags: allTags });
          }
        } catch (e) {
          resolve({ error: e.message || 'Failed to parse tags list' });
        }
      });
    });
    req.on('error', (err) => resolve({ error: err.message }));
    req.setTimeout(25000, () => { req.destroy(); resolve({ error: 'Registry request timeout' }); });
    req.end();
  });
}

module.exports = {
  parseImageRef,
  getRemoteDigest,
  checkUpdateAvailable,
  listTags,
  parseVersionFromTag,
  parseVersionFromString,
  extractVersionFromLabel,
  getNewestVersionTag,
  compareVersionParts,
};
