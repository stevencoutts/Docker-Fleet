const sshService = require('./ssh.service');
const registryService = require('./registry.service');
const logger = require('../config/logger');

/** Comma-separated name suffixes; containers whose name ends with one of these are treated as dev/skip-update. */
const DEFAULT_SKIP_UPDATE_SUFFIXES = '-db-1,-postgres-1,-db';

function getSkipUpdateNamePatterns() {
  const envVal = process.env.SKIP_UPDATE_NAME_PATTERNS ?? process.env.DOCKERFLEET_SKIP_UPDATE_NAME_PATTERNS;
  const raw = (envVal !== undefined && envVal !== null) ? String(envVal) : DEFAULT_SKIP_UPDATE_SUFFIXES;
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function matchesSkipUpdateNamePattern(containerName) {
  const name = (containerName || '').replace(/^\//, '');
  if (!name) return false;
  const patterns = getSkipUpdateNamePatterns();
  return patterns.some(suffix => name.endsWith(suffix) || name === suffix);
}

class DockerService {
  async listContainers(server, all = false) {
    // Use a simpler format that's more reliable
    const command = `docker ps ${all ? '-a' : ''} --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}'`;
    const result = await sshService.executeCommand(server, command);
    
    if (!result.stdout.trim()) {
      return [];
    }

    const lines = result.stdout.trim().split('\n').filter(line => line.trim());
    const containers = [];
    const containerIds = [];
    
    // First pass: parse container data
    for (const line of lines) {
      const parts = line.split('|');
      if (parts.length >= 4) {
        const containerId = parts[0] || '';
        containerIds.push(containerId);
        containers.push({
          ID: containerId,
          Names: parts[1] || '',
          Image: parts[2] || 'Unknown',
          Status: parts[3] || 'Unknown',
          Ports: parts[4] || '',
          RestartPolicy: 'no', // Default, will be updated
        });
      } else {
        // Fallback for malformed lines
        containers.push({
          ID: line.substring(0, 12) || '',
          Names: '',
          Image: 'Unknown',
          Status: 'Unknown',
          Ports: '',
          RestartPolicy: 'no',
        });
      }
    }

    // Batch fetch restart policies, mounts, and networks: docker inspect with multiple IDs returns a single JSON array
    if (containerIds.length > 0) {
      try {
        const idsString = containerIds.join(' ');
        const inspectCommand = `docker inspect ${idsString}`;
        const inspectResult = await sshService.executeCommand(server, inspectCommand, { allowFailure: true });

        if (inspectResult && inspectResult.code === 0 && inspectResult.stdout && inspectResult.stdout.trim()) {
          let inspectArray = [];
          try {
            const parsed = JSON.parse(inspectResult.stdout.trim());
            inspectArray = Array.isArray(parsed) ? parsed : [parsed];
          } catch (e) {
            logger.debug('Failed to parse docker inspect JSON array:', e.message);
          }

          const detailsMap = {};
          for (const data of inspectArray) {
            const fullId = data.Id || data.ID || '';
            const shortId = fullId.substring(0, 12);
            const policy = (data.HostConfig && data.HostConfig.RestartPolicy && data.HostConfig.RestartPolicy.Name) ? data.HostConfig.RestartPolicy.Name : 'no';
            const mounts = Array.isArray(data.Mounts) ? data.Mounts : [];
            const networks = (data.NetworkSettings && data.NetworkSettings && data.NetworkSettings.Networks && typeof data.NetworkSettings.Networks === 'object') ? data.NetworkSettings.Networks : {};
            const labels = data.Config?.Labels || {};
            const name = (data.Name || '').replace(/^\//, '');
            const skipByLabel = !!(labels['com.dockerfleet.skip-update'] || labels['com.dockerfleet.dev']);
            const skipByName = matchesSkipUpdateNamePattern(name);
            const skipUpdate = skipByLabel || skipByName;
            detailsMap[shortId] = { RestartPolicy: policy, Mounts: mounts, Networks: networks, SkipUpdate: skipUpdate };
          }

          containers.forEach(container => {
            const shortId = (container.ID || '').substring(0, 12);
            const details = detailsMap[shortId];
            if (details) {
              container.RestartPolicy = details.RestartPolicy;
              container.Mounts = details.Mounts;
              container.Networks = details.Networks;
              container.SkipUpdate = details.SkipUpdate;
            }
          });
        } else {
          // Fallback: restart policy only via format
          try {
            const idsString = containerIds.join(' ');
            const inspectCommand = `docker inspect ${idsString} --format '{{.Id}}|{{.HostConfig.RestartPolicy.Name}}'`;
            const inspectResult = await sshService.executeCommand(server, inspectCommand, { allowFailure: true });
            if (inspectResult && inspectResult.stdout) {
              const policyLines = inspectResult.stdout.trim().split('\n').filter(line => line.trim());
              const policyMap = {};
              for (const policyLine of policyLines) {
                const [id, policy] = policyLine.split('|');
                if (id && policy) {
                  policyMap[id.substring(0, 12)] = policy.trim() || 'no';
                }
              }
              containers.forEach(container => {
                const shortId = container.ID.substring(0, 12);
                if (policyMap[shortId]) container.RestartPolicy = policyMap[shortId];
              });
            }
          } catch (fallbackErr) {
            logger.debug('Fallback restart policy fetch failed:', fallbackErr.message);
          }
        }
      } catch (error) {
        logger.debug('Failed to batch fetch container details:', error.message);
      }
    }

    return containers;
  }

  async getContainerDetails(server, containerId) {
    const command = `docker inspect ${containerId}`;
    const result = await sshService.executeCommand(server, command);
    
    try {
      const details = JSON.parse(result.stdout);
      return details[0] || details;
    } catch (e) {
      throw new Error('Failed to parse container details');
    }
  }

  /**
   * Check if a container's image has an update available (remote digest differs from local).
   * Containers with label com.dockerfleet.skip-update or com.dockerfleet.dev are treated as pinned (no update suggested).
   * @returns {Promise<{ updateAvailable: boolean, pinned?: boolean, reason?: string, error?: string }>}
   */
  async getContainerUpdateStatus(server, containerId) {
    const timeoutMs = 25000;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Update check timed out')), timeoutMs);
    });

    const run = async () => {
      const details = await this.getContainerDetails(server, containerId);
      const labels = details.Config?.Labels || {};
      if (labels['com.dockerfleet.skip-update'] || labels['com.dockerfleet.dev']) {
        return { updateAvailable: false, pinned: true, reason: 'Container marked as dev/pinned' };
      }
      const containerName = (details.Name || '').replace(/^\//, '');
      if (matchesSkipUpdateNamePattern(containerName)) {
        return { updateAvailable: false, pinned: true, reason: 'Container name matches dev/local pattern' };
      }

      const imageRef = details.Config?.Image || details.Image || '';
      const imageId = details.Image || details.Config?.Image || '';
      if (!imageRef || imageRef.startsWith('sha256:')) {
        return { updateAvailable: false, reason: 'Local or digest-pinned image' };
      }

      const inspectCmd = `docker image inspect ${imageId} --format '{{json .RepoDigests}}'`;
      const inspectResult = await sshService.executeCommand(server, inspectCmd, { allowFailure: true, timeout: 10000 });
      if (!inspectResult.stdout || inspectResult.code !== 0) {
        return { updateAvailable: false, reason: 'Local image has no registry digest' };
      }

      let repoDigests = [];
      try {
        repoDigests = JSON.parse(inspectResult.stdout.trim());
      } catch (e) {
        return { updateAvailable: false, reason: 'Could not parse image digests' };
      }
      if (!Array.isArray(repoDigests) || repoDigests.length === 0) {
        return { updateAvailable: false, reason: 'Local build or untagged image' };
      }

      const localDigest = repoDigests[0].includes('@') ? repoDigests[0].split('@')[1] : repoDigests[0];
      const parsed = registryService.parseImageRef(imageRef);
      const labelsCmd = `docker image inspect ${imageId} --format '{{json .Config.Labels}}'`;
      const labelsResult = await sshService.executeCommand(server, labelsCmd, { allowFailure: true, timeout: 5000 });
      let resolvedVersion = null;
      if (labelsResult.stdout && labelsResult.code === 0) {
        try {
          const labels = JSON.parse(labelsResult.stdout.trim());
          if (labels && typeof labels === 'object') {
            const raw = labels.build_version || labels['org.opencontainers.image.version'] || labels.VERSION || labels.version || null;
            if (raw != null) {
              resolvedVersion = registryService.extractVersionFromLabel(String(raw)) || String(raw);
            }
          }
        } catch (e) { /* ignore */ }
      }
      const [result, tagsResult] = await Promise.all([
        registryService.checkUpdateAvailable({ localDigest, imageRef }),
        !parsed.digestPinned && parsed.registry && parsed.path
          ? registryService.listTags(parsed.registry, parsed.path)
          : Promise.resolve(null),
      ]);
      const short = (d) => (d && d.replace(/^sha256:/i, '').substring(0, 12)) || '';
      const out = {
        updateAvailable: result.updateAvailable,
        imageRef,
        currentTag: parsed.tag || undefined,
        track: (parsed.tag && /^dev($|[-_])/.test(parsed.tag)) ? 'dev' : 'release',
        currentDigest: localDigest,
        availableDigest: result.remoteDigest,
        currentDigestShort: short(localDigest),
        availableDigestShort: short(result.remoteDigest),
        remoteDigest: result.remoteDigest,
        error: result.error,
      };
      if (resolvedVersion) out.resolvedVersion = resolvedVersion;
      if (tagsResult && !tagsResult.error && Array.isArray(tagsResult.tags) && tagsResult.tags.length > 0) {
        out.availableTags = tagsResult.tags;
        const currentTag = parsed.tag || '';
        const resolvedParsed = resolvedVersion ? registryService.parseVersionFromString(resolvedVersion) : null;
        const scheme = resolvedParsed?.scheme || undefined;
        const excludeDevelopment = currentTag === 'latest';
        const newest = registryService.getNewestVersionTag(tagsResult.tags, { scheme, excludeDevelopment });
        if (newest) {
          let currentParsed = null;
          if (currentTag && currentTag !== 'latest' && currentTag !== 'dev' && !/^dev[-_]/.test(currentTag)) {
            currentParsed = registryService.parseVersionFromTag(currentTag);
          } else if (resolvedVersion && (currentTag === 'latest' || currentTag === 'dev' || /^dev[-_]/.test(currentTag))) {
            currentParsed = resolvedParsed || registryService.parseVersionFromString(resolvedVersion);
          }
          const versionLeapOk = !currentParsed || newest.version.major <= currentParsed.major + 1;
          const newestIsActuallyNewer = versionLeapOk && (!currentParsed || registryService.compareVersionParts(currentParsed, newest.version) < 0);
          // Only expose "newest" tag and set updateAvailableByVersion when we'd actually suggest that tag
          // (e.g. avoid showing "Update available" / "Registry tag: 8.1.2135" when latest is 3.1 and 8.x is an unrelated tag)
          if (newestIsActuallyNewer) {
            out.newestTagFromRegistry = newest.tag;
            out.newestTag = newest.tag;
            out.newestTagDisplay = registryService.stripVersionTagPrefix(newest.tag) || newest.tag;
            out.newestVersion = `${newest.version.major}.${newest.version.minor}.${newest.version.patch}${newest.version.scheme === 'semver' && newest.version.ls ? '.' + newest.version.ls : ''}-r${newest.version.r}${newest.version.scheme !== 'semver' && newest.version.ls ? `-ls${newest.version.ls}` : ''}`;
            out.updateAvailableByVersion = true;
            // Show update when digest differs, or when newest is a different (newer) build. Only suppress when digest matches and versions are equal (e.g. 0.4 and 0.4.208 same image).
            const sameVersion = currentParsed && registryService.compareVersionParts(currentParsed, newest.version) === 0;
            if (result.updateAvailable || !sameVersion) out.updateAvailable = true;
          } else if (resolvedVersion) {
            out.resolvedNewerThanTagList = true;
          }
        }
      }
      return out;
    };

    try {
      return await Promise.race([run(), timeoutPromise]);
    } catch (error) {
      logger.debug('getContainerUpdateStatus failed:', error.message);
      return { updateAvailable: false, error: error.message };
    }
  }

  /**
   * Get version string from image labels (build_version, org.opencontainers.image.version, etc.) on the server.
   * @returns {Promise<string|null>}
   */
  async getImageVersionFromLabels(server, imageId) {
    if (!imageId) return null;
    const labelsCmd = `docker image inspect ${imageId} --format '{{json .Config.Labels}}'`;
    const result = await sshService.executeCommand(server, labelsCmd, { allowFailure: true, timeout: 5000 });
    if (!result.stdout || result.code !== 0) return null;
    try {
      const labels = JSON.parse(result.stdout.trim());
      if (!labels || typeof labels !== 'object') return null;
      const raw = labels.build_version || labels['org.opencontainers.image.version'] || labels.VERSION || labels.version || null;
      if (raw == null) return null;
      return registryService.extractVersionFromLabel(String(raw)) || String(raw);
    } catch (e) {
      return null;
    }
  }

  /**
   * Pull the container's image and recreate the container so it uses the new image (same name and settings).
   * @returns {Promise<{ success: boolean, message?: string, error?: string, containerName?, previousImageRef?, newImageRef?, previousVersion?, newVersion? }>}
   */
  async pullAndRecreateContainer(server, containerId, options = {}) {
    const steps = [];
    const addStep = (name, success, detail = null) => {
      steps.push({ step: name, success: !!success, detail: detail || undefined });
      if (options.onStep) options.onStep(name, !!success, detail || undefined);
    };
    try {
      const details = await this.getContainerDetails(server, containerId);
      const imageRef = details.Config?.Image || details.Image || '';
      const imageId = details.Image || details.Config?.Image || '';
      const name = (details.Name || '').replace(/^\//, '');
      const previousVersion = await this.getImageVersionFromLabels(server, imageId);
      if (!imageRef || imageRef.startsWith('sha256:')) {
        addStep('Validate container', false, 'Digest-pinned or local image');
        return { success: false, error: 'Container uses a digest-pinned or local image; cannot update by tag', steps };
      }
      if (!name) {
        addStep('Validate container', false, 'No container name');
        return { success: false, error: 'Could not get container name', steps };
      }
      addStep('Validate container', true, `"${name}" using ${imageRef}`);

      const pullResult = await this.pullImage(server, imageRef);
      addStep('Pull image', pullResult.success, pullResult.success ? imageRef : (pullResult.message || 'Pull failed'));
      if (!pullResult.success) {
        return { success: false, error: pullResult.message || 'Image pull failed', steps };
      }

      const tempName = `${name}-new-${Date.now()}`;

      // Preserve mounts: prefer HostConfig.Binds; fallback to building from top-level Mounts (bind mounts store config/settings)
      let binds = details.HostConfig?.Binds;
      if (!binds || !Array.isArray(binds) || binds.length === 0) {
        const topMounts = details.Mounts;
        if (topMounts && Array.isArray(topMounts) && topMounts.length > 0) {
          binds = topMounts.map((m) => {
            const src = m.Source || m.Name || '';
            const dst = m.Destination || m.Target || '';
            const mode = m.RW === false ? 'ro' : 'rw';
            return src && dst ? `${src}:${dst}:${mode}` : null;
          }).filter(Boolean);
        }
      }
      if (!binds || binds.length === 0) {
        binds = null;
      }

      const createBody = {
        Image: imageRef,
        Cmd: details.Config?.Cmd || null,
        Entrypoint: details.Config?.Entrypoint || null,
        Env: details.Config?.Env || null,
        WorkingDir: details.Config?.WorkingDir || null,
        Labels: details.Config?.Labels || null,
        Hostname: details.Config?.Hostname || null,
        HostConfig: {
          Binds: binds,
          PortBindings: details.HostConfig?.PortBindings || null,
          RestartPolicy: details.HostConfig?.RestartPolicy || null,
          NetworkMode: details.HostConfig?.NetworkMode || null,
          Mounts: details.HostConfig?.Mounts || null,
          Links: details.HostConfig?.Links || null,
          ExtraHosts: details.HostConfig?.ExtraHosts || null,
        },
      };
      const payload = JSON.stringify(createBody);
      const b64 = Buffer.from(payload, 'utf8').toString('base64');

      const createCmd = `echo ${b64} | base64 -d > /tmp/dockerfleet-create.json && curl -s -X POST --unix-socket /var/run/docker.sock -H "Content-Type: application/json" -d @/tmp/dockerfleet-create.json "http://localhost/v1.44/containers/create?name=${tempName}"`;
      const createResult = await sshService.executeCommand(server, createCmd, { allowFailure: true, timeout: 15000 });
      await sshService.executeCommand(server, 'rm -f /tmp/dockerfleet-create.json', { allowFailure: true });

      let createResp = null;
      try {
        createResp = JSON.parse(createResult.stdout.trim());
      } catch (e) {
        createResp = {};
      }
      if (createResult.code !== 0 || !createResult.stdout.trim()) {
        const errMsg = (createResult.stderr || createResult.stdout || '').trim() || 'Create failed';
        try {
          const errJson = JSON.parse(errMsg);
          addStep('Create new container', false, errJson.message || errMsg);
          return { success: false, error: errJson.message || errMsg, steps };
        } catch (e) {
          addStep('Create new container', false, errMsg);
          return { success: false, error: errMsg, steps };
        }
      }
      if (createResp.message && !createResp.Id && !createResp.id) {
        addStep('Create new container', false, createResp.message);
        return { success: false, error: createResp.message + ' (original container was not changed)', steps };
      }

      const newContainerId = createResp.Id || createResp.id;
      if (!newContainerId || typeof newContainerId !== 'string') {
        addStep('Create new container', false, 'No container ID in response');
        return { success: false, error: 'Create did not return a container ID; original container was not changed', steps };
      }
      addStep('Create new container', true, `ID ${newContainerId.substring(0, 12)}`);

      const verifyResult = await sshService.executeCommand(server, `docker inspect -f '{{.Id}}' ${newContainerId}`, { allowFailure: true, timeout: 5000 });
      if (verifyResult.code !== 0 || !verifyResult.stdout.trim()) {
        await sshService.executeCommand(server, `docker rm -f '${newContainerId}'`, { allowFailure: true });
        addStep('Verify new container', false, 'Container not found after create');
        return { success: false, error: 'New container could not be verified; original container was not changed', steps };
      }
      addStep('Verify new container', true, 'New container exists');

      const stopResult = await this.stopContainer(server, containerId);
      addStep('Stop old container', stopResult.success, stopResult.success ? containerId.substring(0, 12) : (stopResult.message || 'Stop failed'));
      if (!stopResult.success) {
        await sshService.executeCommand(server, `docker rm -f '${newContainerId}'`, { allowFailure: true });
        return { success: false, error: 'Failed to stop existing container; new container was removed', steps };
      }
      const rmResult = await sshService.executeCommand(server, `docker rm ${containerId}`, { allowFailure: true });
      addStep('Remove old container', rmResult.code === 0, rmResult.code === 0 ? 'Removed' : (rmResult.stderr || rmResult.stdout || 'Failed'));
      if (rmResult.code !== 0) {
        await sshService.executeCommand(server, `docker rm -f '${newContainerId}'`, { allowFailure: true });
        return { success: false, error: 'Failed to remove existing container; new container was removed', steps };
      }

      const renameTarget = (name || '').replace(/'/g, "'\\''");
      const renameResult = await sshService.executeCommand(server, `docker rename '${newContainerId}' '${renameTarget}'`, { allowFailure: true });
      addStep('Rename new container', renameResult.code === 0, renameResult.code === 0 ? `"${name}"` : ((renameResult.stderr || renameResult.stdout || '').trim() || 'Failed'));
      if (renameResult.code !== 0) {
        const errDetail = (renameResult.stderr || renameResult.stdout || '').trim();
        return { success: false, error: errDetail ? `Failed to rename new container: ${errDetail}. You may have a container with ID ${newContainerId.substring(0, 12)} that you can rename or remove manually.` : 'Failed to rename new container', steps };
      }

      const startResult = await this.startContainer(server, name);
      addStep('Start new container', startResult.success, startResult.success ? 'Running' : (startResult.message || 'Start failed'));
      if (!startResult.success) {
        return { success: false, error: 'Container recreated but start failed: ' + (startResult.message || ''), newContainerId, steps };
      }
      let newVersion = null;
      try {
        const newDetails = await this.getContainerDetails(server, newContainerId);
        const newImageId = newDetails?.Image || newDetails?.Config?.Image;
        if (newImageId) newVersion = await this.getImageVersionFromLabels(server, newImageId);
      } catch (e) { /* ignore */ }
      return {
        success: true,
        message: `Updated successfully. Container "${name}" is now running the latest image.`,
        newContainerId,
        steps,
        containerName: name,
        previousImageRef: imageRef,
        newImageRef: imageRef,
        previousVersion: previousVersion || undefined,
        newVersion: newVersion || undefined,
      };
    } catch (error) {
      logger.debug('pullAndRecreateContainer failed:', error.message);
      addStep('Update process', false, error.message);
      return { success: false, error: error.message, steps };
    }
  }

  /**
   * Recreate the container with the same image and settings (mounts, ports, env, etc.) without pulling.
   * Use to fix missing mounts or refresh the container when there is no image update.
   */
  async recreateContainer(server, containerId, options = {}) {
    const steps = [];
    const addStep = (name, success, detail = null) => {
      steps.push({ step: name, success: !!success, detail: detail || undefined });
      if (options.onStep) options.onStep(name, !!success, detail || undefined);
    };
    try {
      const details = await this.getContainerDetails(server, containerId);
      const imageRef = details.Config?.Image || details.Image || '';
      const name = (details.Name || '').replace(/^\//, '');
      if (!imageRef) {
        addStep('Validate container', false, 'No image reference');
        return { success: false, error: 'Could not get container image', steps };
      }
      if (!name) {
        addStep('Validate container', false, 'No container name');
        return { success: false, error: 'Could not get container name', steps };
      }
      addStep('Validate container', true, `"${name}" using ${imageRef}`);

      const tempName = `${name}-new-${Date.now()}`;

      let binds = details.HostConfig?.Binds;
      if (!binds || !Array.isArray(binds) || binds.length === 0) {
        const topMounts = details.Mounts;
        if (topMounts && Array.isArray(topMounts) && topMounts.length > 0) {
          binds = topMounts.map((m) => {
            const src = m.Source || m.Name || '';
            const dst = m.Destination || m.Target || '';
            const mode = m.RW === false ? 'ro' : 'rw';
            return src && dst ? `${src}:${dst}:${mode}` : null;
          }).filter(Boolean);
        }
      }
      if (!binds || binds.length === 0) {
        binds = null;
      }

      const createBody = {
        Image: imageRef,
        Cmd: details.Config?.Cmd || null,
        Entrypoint: details.Config?.Entrypoint || null,
        Env: details.Config?.Env || null,
        WorkingDir: details.Config?.WorkingDir || null,
        Labels: details.Config?.Labels || null,
        Hostname: details.Config?.Hostname || null,
        HostConfig: {
          Binds: binds,
          PortBindings: details.HostConfig?.PortBindings || null,
          RestartPolicy: details.HostConfig?.RestartPolicy || null,
          NetworkMode: details.HostConfig?.NetworkMode || null,
          Mounts: details.HostConfig?.Mounts || null,
          Links: details.HostConfig?.Links || null,
          ExtraHosts: details.HostConfig?.ExtraHosts || null,
        },
      };
      const payload = JSON.stringify(createBody);
      const b64 = Buffer.from(payload, 'utf8').toString('base64');

      const createCmd = `echo ${b64} | base64 -d > /tmp/dockerfleet-create.json && curl -s -X POST --unix-socket /var/run/docker.sock -H "Content-Type: application/json" -d @/tmp/dockerfleet-create.json "http://localhost/v1.44/containers/create?name=${tempName}"`;
      const createResult = await sshService.executeCommand(server, createCmd, { allowFailure: true, timeout: 15000 });
      await sshService.executeCommand(server, 'rm -f /tmp/dockerfleet-create.json', { allowFailure: true });

      let createResp = null;
      try {
        createResp = JSON.parse(createResult.stdout.trim());
      } catch (e) {
        createResp = {};
      }
      if (createResult.code !== 0 || !createResult.stdout.trim()) {
        const errMsg = (createResult.stderr || createResult.stdout || '').trim() || 'Create failed';
        try {
          const errJson = JSON.parse(errMsg);
          addStep('Create new container', false, errJson.message || errMsg);
          return { success: false, error: errJson.message || errMsg, steps };
        } catch (e) {
          addStep('Create new container', false, errMsg);
          return { success: false, error: errMsg, steps };
        }
      }
      if (createResp.message && !createResp.Id && !createResp.id) {
        addStep('Create new container', false, createResp.message);
        return { success: false, error: createResp.message + ' (original container was not changed)', steps };
      }

      const newContainerId = createResp.Id || createResp.id;
      if (!newContainerId || typeof newContainerId !== 'string') {
        addStep('Create new container', false, 'No container ID in response');
        return { success: false, error: 'Create did not return a container ID; original container was not changed', steps };
      }
      addStep('Create new container', true, `ID ${newContainerId.substring(0, 12)}`);

      const verifyResult = await sshService.executeCommand(server, `docker inspect -f '{{.Id}}' ${newContainerId}`, { allowFailure: true, timeout: 5000 });
      if (verifyResult.code !== 0 || !verifyResult.stdout.trim()) {
        await sshService.executeCommand(server, `docker rm -f '${newContainerId}'`, { allowFailure: true });
        addStep('Verify new container', false, 'Container not found after create');
        return { success: false, error: 'New container could not be verified; original container was not changed', steps };
      }
      addStep('Verify new container', true, 'New container exists');

      const stopResult = await this.stopContainer(server, containerId);
      addStep('Stop old container', stopResult.success, stopResult.success ? containerId.substring(0, 12) : (stopResult.message || 'Stop failed'));
      if (!stopResult.success) {
        await sshService.executeCommand(server, `docker rm -f '${newContainerId}'`, { allowFailure: true });
        return { success: false, error: 'Failed to stop existing container; new container was removed', steps };
      }
      const rmResult = await sshService.executeCommand(server, `docker rm ${containerId}`, { allowFailure: true });
      addStep('Remove old container', rmResult.code === 0, rmResult.code === 0 ? 'Removed' : (rmResult.stderr || rmResult.stdout || 'Failed'));
      if (rmResult.code !== 0) {
        await sshService.executeCommand(server, `docker rm -f '${newContainerId}'`, { allowFailure: true });
        return { success: false, error: 'Failed to remove existing container; new container was removed', steps };
      }

      const renameTarget = (name || '').replace(/'/g, "'\\''");
      const renameResult = await sshService.executeCommand(server, `docker rename '${newContainerId}' '${renameTarget}'`, { allowFailure: true });
      addStep('Rename new container', renameResult.code === 0, renameResult.code === 0 ? `"${name}"` : ((renameResult.stderr || renameResult.stdout || '').trim() || 'Failed'));
      if (renameResult.code !== 0) {
        const errDetail = (renameResult.stderr || renameResult.stdout || '').trim();
        return { success: false, error: errDetail ? `Failed to rename new container: ${errDetail}. You may have a container with ID ${newContainerId.substring(0, 12)} that you can rename or remove manually.` : 'Failed to rename new container', steps };
      }

      const startResult = await this.startContainer(server, name);
      addStep('Start new container', startResult.success, startResult.success ? 'Running' : (startResult.message || 'Start failed'));
      if (!startResult.success) {
        return { success: false, error: 'Container recreated but start failed: ' + (startResult.message || ''), newContainerId, steps };
      }
      return { success: true, message: `Container "${name}" recreated successfully with the same settings.`, newContainerId, steps };
    } catch (error) {
      logger.debug('recreateContainer failed:', error.message);
      addStep('Recreate process', false, error.message);
      return { success: false, error: error.message, steps };
    }
  }

  async getContainerLogs(server, containerId, options = {}) {
    const { tail = 100, follow = false, since } = options;
    let command = `docker logs ${containerId}`;
    
    if (tail) command += ` --tail ${tail}`;
    if (since) command += ` --since ${since}`;
    if (follow) command += ' --follow';

    if (follow) {
      // Return a stream handler
      return {
        stream: true,
        execute: (onData, onError) => {
          return sshService.executeStream(server, command, onData, onError);
        },
      };
    } else {
      const result = await sshService.executeCommand(server, command);
      return {
        stream: false,
        logs: result.stdout,
      };
    }
  }

  async startContainer(server, containerId) {
    const command = `docker start ${containerId}`;
    const result = await sshService.executeCommand(server, command);
    return { success: result.code === 0, message: result.stdout || result.stderr };
  }

  async stopContainer(server, containerId) {
    const command = `docker stop ${containerId}`;
    const result = await sshService.executeCommand(server, command);
    return { success: result.code === 0, message: result.stdout || result.stderr };
  }

  async restartContainer(server, containerId) {
    const command = `docker restart ${containerId}`;
    const result = await sshService.executeCommand(server, command);
    return { success: result.code === 0, message: result.stdout || result.stderr };
  }

  async removeContainer(server, containerId, force = false) {
    const command = `docker rm ${force ? '-f' : ''} ${containerId}`;
    const result = await sshService.executeCommand(server, command);
    return { success: result.code === 0, message: result.stdout || result.stderr };
  }

  async updateRestartPolicy(server, containerId, policy = 'unless-stopped') {
    // Valid policies: no, always, on-failure, unless-stopped
    const validPolicies = ['no', 'always', 'on-failure', 'unless-stopped'];
    if (!validPolicies.includes(policy)) {
      throw new Error(`Invalid restart policy: ${policy}. Must be one of: ${validPolicies.join(', ')}`);
    }

    // Use docker update to change restart policy
    const command = `docker update --restart=${policy} ${containerId}`;
    const result = await sshService.executeCommand(server, command);
    
    if (result.code !== 0) {
      throw new Error(`Failed to update restart policy: ${result.stderr || result.stdout}`);
    }
    
    return { 
      success: true, 
      message: `Restart policy updated to: ${policy}`,
      restartPolicy: policy
    };
  }

  async executeCommand(server, containerId, command, options = {}) {
    // Execute a command inside a container using docker exec
    // Default to /bin/sh if no shell is specified
    const shell = options.shell || '/bin/sh';
    
    let finalCommand = command;
    
    // Make interactive commands work by converting them to non-interactive versions
    // Handle pagers (more, less) by making them non-interactive
    if (command.trim().startsWith('more ')) {
      // Convert 'more file' to 'cat file' for simplicity, or use more with non-interactive flags
      // Using cat is simpler and works everywhere
      const args = command.substring(5).trim();
      finalCommand = `cat ${args}`;
    } else if (command.trim().startsWith('less ')) {
      // Convert 'less file' to 'cat file' or use less with non-interactive flags
      const args = command.substring(5).trim();
      // Try less with -F (quit if one screen) and -X (don't clear screen) flags
      // If that doesn't work, fall back to cat
      finalCommand = `less -F -X ${args} 2>/dev/null || cat ${args}`;
    } else if (command.trim() === 'more' || command.trim() === 'less') {
      // Just 'more' or 'less' without args - convert to cat
      finalCommand = 'cat';
    } else {
      // For other potentially interactive commands (vi, vim, nano, emacs, htop), 
      // we can't make them work, so we'll let them timeout with a helpful message
      const interactiveCommands = ['vi ', 'vim ', 'nano ', 'emacs ', 'htop'];
      const commandLower = command.toLowerCase();
      const isInteractive = interactiveCommands.some(cmd => commandLower.includes(cmd));
      
      if (isInteractive) {
        // For editors and htop, we can't make them work, so wrap with timeout
        finalCommand = `timeout 5s sh -c '${command.replace(/'/g, "'\\''")}' 2>&1 || echo "Interactive commands like '${command.split(' ')[0]}' are not supported. Use 'cat' to view files."`;
      }
    }
    
    // Build docker exec command - use sh -c to execute the command
    // Escape single quotes in the command
    const escapedCommand = finalCommand.replace(/'/g, "'\\''");
    const dockerCommand = `docker exec -i ${containerId} ${shell} -c '${escapedCommand}'`;
    
    const result = await sshService.executeCommand(server, dockerCommand, {
      allowFailure: true,
      timeout: options.timeout || 10000, // 10 second timeout for console commands
      ...options,
    });
    
    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      code: result.code || 0,
      success: result.code === 0,
    };
  }

  async getContainerStats(server, containerId) {
    // Try Docker API first (most reliable for full stats)
    try {
      const apiCommand = `curl -s --unix-socket /var/run/docker.sock http://localhost/containers/${containerId}/stats?stream=false 2>/dev/null`;
      const apiResult = await sshService.executeCommand(server, apiCommand, { allowFailure: true });
      
      if (apiResult.code === 0 && apiResult.stdout.trim()) {
        try {
          const stats = JSON.parse(apiResult.stdout.trim());
          // Validate we got proper stats structure
          if (stats && (stats.memory_stats || stats.cpu_stats)) {
            // Log network stats for debugging
            logger.debug('Docker API stats networks:', stats.networks ? Object.keys(stats.networks) : 'none');
            if (stats.networks) {
              Object.entries(stats.networks).forEach(([iface, data]) => {
                logger.debug(`Network ${iface}: rx_bytes=${data.rx_bytes}, tx_bytes=${data.tx_bytes}`);
              });
            }
            
            // Ensure networks object exists and has proper structure with actual stats
            if (!stats.networks || Object.keys(stats.networks).length === 0 || 
                Object.values(stats.networks).every(net => (net.rx_bytes || 0) === 0 && (net.tx_bytes || 0) === 0)) {
              // Try to get network stats from /proc/net/dev (most reliable for cumulative stats)
              try {
                const pidCommand = `docker inspect ${containerId} --format '{{.State.Pid}}'`;
                const pidResult = await sshService.executeCommand(server, pidCommand, { allowFailure: true });
                
                if (pidResult.code === 0 && pidResult.stdout.trim()) {
                  const pid = pidResult.stdout.trim();
                  // Read network stats from /proc/net/dev (cumulative since container start)
                  const procNetCommand = `cat /proc/${pid}/net/dev 2>/dev/null | grep -E 'eth0|veth' | head -1`;
                  const procNetResult = await sshService.executeCommand(server, procNetCommand, { allowFailure: true });
                  
                  // Get network interface names from docker inspect
                  const networkCommand = `docker inspect ${containerId} --format '{{json .NetworkSettings.Networks}}'`;
                  const networkResult = await sshService.executeCommand(server, networkCommand, { allowFailure: true });
                  
                  let netRxBytes = 0;
                  let netTxBytes = 0;
                  
                  if (procNetResult.code === 0 && procNetResult.stdout.trim()) {
                    // Parse /proc/net/dev format: interface: rx_bytes rx_packets ... tx_bytes tx_packets ...
                    const parts = procNetResult.stdout.trim().split(/\s+/);
                    if (parts.length >= 10) {
                      netRxBytes = parseInt(parts[1]) || 0;
                      netTxBytes = parseInt(parts[9]) || 0;
                    }
                  }
                  
                  if (networkResult.code === 0 && networkResult.stdout.trim()) {
                    const networkData = JSON.parse(networkResult.stdout.trim());
                    if (networkData && typeof networkData === 'object') {
                      stats.networks = {};
                      Object.keys(networkData).forEach(iface => {
                        stats.networks[iface] = {
                          rx_bytes: netRxBytes,
                          tx_bytes: netTxBytes,
                          rx_packets: 0,
                          tx_packets: 0,
                          rx_errors: 0,
                          tx_errors: 0,
                          rx_dropped: 0,
                          tx_dropped: 0,
                        };
                      });
                    }
                  } else if (netRxBytes > 0 || netTxBytes > 0) {
                    // If we have stats but no interface names, create default
                    stats.networks = {
                      eth0: {
                        rx_bytes: netRxBytes,
                        tx_bytes: netTxBytes,
                        rx_packets: 0,
                        tx_packets: 0,
                        rx_errors: 0,
                        tx_errors: 0,
                        rx_dropped: 0,
                        tx_dropped: 0,
                      }
                    };
                  }
                }
              } catch (e) {
                logger.debug('Failed to get network stats from /proc:', e.message);
              }
            }
            return stats;
          }
        } catch (parseError) {
          logger.debug('Failed to parse Docker API response, trying fallback');
        }
      }
    } catch (apiError) {
      logger.debug('Docker API not available, using fallback method');
    }
    
    // Fallback: Use docker stats and docker inspect to build stats object
    try {
      // Get basic stats from docker stats
      const statsCommand = `docker stats ${containerId} --no-stream --format '{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}|{{.BlockIO}}|{{.PIDs}}'`;
      const statsResult = await sshService.executeCommand(server, statsCommand, { allowFailure: true });
      
      // Get detailed info from docker inspect
      const inspectCommand = `docker inspect ${containerId} --format '{{json .HostConfig.Memory}}|{{json .State.Pid}}'`;
      const inspectResult = await sshService.executeCommand(server, inspectCommand, { allowFailure: true });
      
      let cpuPercent = 0;
      let memUsage = 0;
      let memLimit = 0;
      let memPercent = 0;
      let pids = 0;
      let netRx = 0;
      let netTx = 0;
      
      if (statsResult.code === 0 && statsResult.stdout.trim()) {
        const parts = statsResult.stdout.trim().split('|');
        if (parts.length >= 6) {
          cpuPercent = parseFloat(parts[0].replace('%', '').trim()) || 0;
          pids = parseInt(parts[5] || '0') || 0;
          
          // Parse memory (e.g., "1.2GiB / 15.62GiB")
          const memStr = parts[1].trim();
          const memParts = memStr.split('/');
          if (memParts.length === 2) {
            memUsage = this.parseSize(memParts[0].trim());
            memLimit = this.parseSize(memParts[1].trim());
          }
          memPercent = parseFloat(parts[2].replace('%', '').trim()) || 0;
          
          // Parse NetIO (e.g., "1.2MB / 500KB" or "1.2MiB / 500KiB")
          if (parts[3]) {
            const netParts = parts[3].trim().split('/');
            if (netParts.length === 2) {
              netRx = this.parseSize(netParts[0].trim());
              netTx = this.parseSize(netParts[1].trim());
            }
          }
        }
      }
      
      // Get memory limit from inspect if available
      if (inspectResult.code === 0 && inspectResult.stdout.trim()) {
        const inspectParts = inspectResult.stdout.trim().split('|');
        if (inspectParts[0] && inspectParts[0] !== 'null' && inspectParts[0] !== '0') {
          try {
            const memoryLimit = parseInt(inspectParts[0]);
            if (memoryLimit > 0) {
              memLimit = memoryLimit;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
      
      // If we still don't have memLimit, try to get it from the container
      if (memLimit === 0) {
        try {
          const memInfoCommand = `docker inspect ${containerId} --format '{{.HostConfig.Memory}}'`;
          const memInfoResult = await sshService.executeCommand(server, memInfoCommand, { allowFailure: true });
          if (memInfoResult.code === 0 && memInfoResult.stdout.trim()) {
            const limit = parseInt(memInfoResult.stdout.trim());
            if (limit > 0) {
              memLimit = limit;
            }
          }
        } catch (e) {
          // Ignore
        }
      }
      
      // Get network interface details and actual stats from container's network namespace
      let networks = {};
      try {
        // First, get network interface names
        const networkCommand = `docker inspect ${containerId} --format '{{json .NetworkSettings.Networks}}'`;
        const networkResult = await sshService.executeCommand(server, networkCommand, { allowFailure: true });
        
        if (networkResult.code === 0 && networkResult.stdout.trim()) {
          try {
            const networkData = JSON.parse(networkResult.stdout.trim());
            if (networkData && typeof networkData === 'object') {
              // Get the container's PID to access /proc/net/dev
              const pidCommand = `docker inspect ${containerId} --format '{{.State.Pid}}'`;
              const pidResult = await sshService.executeCommand(server, pidCommand, { allowFailure: true });
              
              if (pidResult.code === 0 && pidResult.stdout.trim()) {
                const pid = pidResult.stdout.trim();
                // Read network stats from /proc/net/dev (cumulative since container start)
                const procNetCommand = `cat /proc/${pid}/net/dev 2>/dev/null | grep -E 'eth0|veth' | head -1`;
                const procNetResult = await sshService.executeCommand(server, procNetCommand, { allowFailure: true });
                
                let actualRxBytes = netRx || 0;
                let actualTxBytes = netTx || 0;
                
                if (procNetResult.code === 0 && procNetResult.stdout.trim()) {
                  // Parse /proc/net/dev format: interface: rx_bytes rx_packets ... tx_bytes tx_packets ...
                  const parts = procNetResult.stdout.trim().split(/\s+/);
                  if (parts.length >= 10) {
                    actualRxBytes = parseInt(parts[1]) || 0;
                    actualTxBytes = parseInt(parts[9]) || 0;
                  }
                }
                
                // Create network objects with cumulative stats
                Object.keys(networkData).forEach(iface => {
                  networks[iface] = {
                    rx_bytes: actualRxBytes,
                    tx_bytes: actualTxBytes,
                    rx_packets: 0,
                    tx_packets: 0,
                    rx_errors: 0,
                    tx_errors: 0,
                    rx_dropped: 0,
                    tx_dropped: 0,
                  };
                });
              } else {
                // Fallback: use NetIO from docker stats if we can't get /proc/net/dev
                Object.keys(networkData).forEach(iface => {
                  networks[iface] = {
                    rx_bytes: netRx || 0,
                    tx_bytes: netTx || 0,
                    rx_packets: 0,
                    tx_packets: 0,
                    rx_errors: 0,
                    tx_errors: 0,
                    rx_dropped: 0,
                    tx_dropped: 0,
                  };
                });
              }
            }
          } catch (e) {
            logger.debug('Failed to parse network data:', e.message);
          }
        }
      } catch (e) {
        logger.debug('Failed to get network data:', e.message);
      }
      
      // If we have network stats but no network interfaces, create a default one
      if (Object.keys(networks).length === 0) {
        // Try to get actual network stats from /proc/net/dev
        try {
          const pidCommand = `docker inspect ${containerId} --format '{{.State.Pid}}'`;
          const pidResult = await sshService.executeCommand(server, pidCommand, { allowFailure: true });
          
          if (pidResult.code === 0 && pidResult.stdout.trim()) {
            const pid = pidResult.stdout.trim();
            const procNetCommand = `cat /proc/${pid}/net/dev 2>/dev/null | grep -E 'eth0|veth' | head -1`;
            const procNetResult = await sshService.executeCommand(server, procNetCommand, { allowFailure: true });
            
            let actualRxBytes = netRx || 0;
            let actualTxBytes = netTx || 0;
            
            if (procNetResult.code === 0 && procNetResult.stdout.trim()) {
              const parts = procNetResult.stdout.trim().split(/\s+/);
              if (parts.length >= 10) {
                actualRxBytes = parseInt(parts[1]) || 0;
                actualTxBytes = parseInt(parts[9]) || 0;
              }
            }
            
            networks.eth0 = {
              rx_bytes: actualRxBytes,
              tx_bytes: actualTxBytes,
              rx_packets: 0,
              tx_packets: 0,
              rx_errors: 0,
              tx_errors: 0,
              rx_dropped: 0,
              tx_dropped: 0,
            };
          } else {
            // Last resort: use NetIO from docker stats
            networks.eth0 = {
              rx_bytes: netRx || 0,
              tx_bytes: netTx || 0,
              rx_packets: 0,
              tx_packets: 0,
              rx_errors: 0,
              tx_errors: 0,
              rx_dropped: 0,
              tx_dropped: 0,
            };
          }
        } catch (e) {
          logger.debug('Failed to get network stats from /proc:', e.message);
          // Last resort
          if (netRx > 0 || netTx > 0) {
            networks.eth0 = {
              rx_bytes: netRx,
              tx_bytes: netTx,
              rx_packets: 0,
              tx_packets: 0,
              rx_errors: 0,
              tx_errors: 0,
              rx_dropped: 0,
              tx_dropped: 0,
            };
          }
        }
      }
      
      // Construct stats object compatible with frontend expectations
      return {
        memory_stats: {
          usage: memUsage,
          limit: memLimit || (memUsage > 0 ? Math.round(memUsage / (memPercent / 100)) : 0),
          max_usage: memUsage,
        },
        cpu_stats: {
          cpu_usage: {
            total_usage: 0,
          },
          system_cpu_usage: 0,
          online_cpus: 1,
        },
        precpu_stats: {
          cpu_usage: {
            total_usage: 0,
          },
          system_cpu_usage: 0,
        },
        networks: networks,
        blkio_stats: {
          io_service_bytes_recursive: [],
        },
        pids_stats: {
          current: pids,
        },
        _cpuPercent: cpuPercent,
        _memPercent: memPercent,
      };
    } catch (e) {
      logger.error('Failed to get container stats:', e);
      return null;
    }
  }

  parseSize(sizeStr) {
    // Parse size strings like "1.2GiB", "500MiB", "1024B" to bytes
    if (!sizeStr) return 0;
    
    const units = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024,
      'TB': 1024 * 1024 * 1024 * 1024,
      'KiB': 1024,
      'MiB': 1024 * 1024,
      'GiB': 1024 * 1024 * 1024,
      'TiB': 1024 * 1024 * 1024 * 1024,
    };
    
    const match = sizeStr.trim().match(/^([\d.]+)\s*([A-Za-z]+)$/);
    if (match) {
      const value = parseFloat(match[1]);
      const unit = match[2];
      return Math.round(value * (units[unit] || 1));
    }
    
    return 0;
  }

  async listImages(server) {
    const command = `docker images --format '{"Repository":"{{.Repository}}","Tag":"{{.Tag}}","ImageID":"{{.ID}}","Created":"{{.CreatedAt}}","Size":"{{.Size}}"}'`;
    const result = await sshService.executeCommand(server, command);
    
    if (!result.stdout.trim()) {
      return [];
    }

    const lines = result.stdout.trim().split('\n').filter(line => line.trim());
    return lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch (e) {
        const parts = line.split(/\s{2,}/);
        return {
          Repository: parts[0] || '',
          Tag: parts[1] || '',
          ImageID: parts[2] || '',
          Created: parts[3] || '',
          Size: parts[4] || '',
        };
      }
    });
  }

  async pullImage(server, imageName) {
    const command = `docker pull ${imageName}`;
    const result = await sshService.executeCommand(server, command, { allowFailure: true });
    return {
      success: result.code === 0,
      message: result.stdout || result.stderr,
    };
  }

  async removeImage(server, imageId, force = false) {
    const command = `docker rmi ${force ? '-f' : ''} ${imageId}`;
    const result = await sshService.executeCommand(server, command);
    return { success: result.code === 0, message: result.stdout || result.stderr };
  }

  async commitContainer(server, containerId, imageName, tag = 'snapshot') {
    // Commit container to an image
    // Format: imageName:tag
    const fullImageName = tag ? `${imageName}:${tag}` : imageName;
    const command = `docker commit ${containerId} ${fullImageName}`;
    const result = await sshService.executeCommand(server, command, { allowFailure: true });
    
    if (result.code !== 0) {
      throw new Error(`Failed to commit container: ${result.stderr || result.stdout}`);
    }
    
    return {
      success: true,
      imageName: fullImageName,
      message: `Container committed to image: ${fullImageName}`,
    };
  }

  async exportImage(server, imageName, outputPath) {
    // Export image to a tar file
    // docker save -o outputPath imageName
    const command = `docker save -o ${outputPath} ${imageName}`;
    const result = await sshService.executeCommand(server, command, { allowFailure: true });
    
    if (result.code !== 0) {
      throw new Error(`Failed to export image: ${result.stderr || result.stdout}`);
    }
    
    return {
      success: true,
      filePath: outputPath,
      message: `Image exported to: ${outputPath}`,
    };
  }

  async downloadFile(server, remotePath) {
    // Download a file from the remote server using SSH SFTP
    const ssh = await sshService.connect(server);
    
    return new Promise((resolve, reject) => {
      ssh.sftp((err, sftp) => {
        if (err) {
          reject(new Error(`SFTP connection failed: ${err.message}`));
          return;
        }

        sftp.readFile(remotePath, (err, data) => {
          if (err) {
            reject(new Error(`Failed to read file ${remotePath}: ${err.message}`));
            return;
          }
          resolve(data);
        });
      });
    });
  }

  async deleteFile(server, filePath) {
    // Delete a file from the remote server
    const command = `rm -f ${filePath}`;
    const result = await sshService.executeCommand(server, command, { allowFailure: true });
    return { success: result.code === 0 };
  }

  async getSystemInfo(server) {
    const command = `docker system info`;
    const result = await sshService.executeCommand(server, command);
    
    return { raw: result.stdout };
  }

  async getHostInfo(server) {
    const results = {};
    
    // Basic system info - simple commands first
    try {
      const archResult = await sshService.executeCommand(server, 'uname -m', { allowFailure: true });
      results.architecture = (archResult && archResult.stdout) ? archResult.stdout.trim() : 'Unknown';
    } catch (error) {
      logger.warn('Architecture command failed:', error.message);
      results.architecture = 'Unknown';
    }

    try {
      const kernelResult = await sshService.executeCommand(server, 'uname -r', { allowFailure: true });
      results.kernel = (kernelResult && kernelResult.stdout) ? kernelResult.stdout.trim() : 'Unknown';
    } catch (error) {
      logger.debug('Kernel command failed:', error.message);
      results.kernel = 'Unknown';
    }

    try {
      const osResult = await sshService.executeCommand(server, 'uname -s', { allowFailure: true });
      results.os = (osResult && osResult.stdout) ? osResult.stdout.trim() : 'Unknown';
    } catch (error) {
      logger.debug('OS command failed:', error.message);
      results.os = 'Unknown';
    }

    try {
      // Try to get FQDN first, fallback to short hostname
      const fqdnResult = await sshService.executeCommand(server, 'hostname -f', { allowFailure: true });
      if (fqdnResult && fqdnResult.stdout && fqdnResult.stdout.trim()) {
        results.hostname = fqdnResult.stdout.trim();
      } else {
        // Fallback to short hostname if FQDN not available
        const hostnameResult = await sshService.executeCommand(server, 'hostname', { allowFailure: true });
        results.hostname = (hostnameResult && hostnameResult.stdout) ? hostnameResult.stdout.trim() : 'Unknown';
      }
    } catch (error) {
      logger.debug('Hostname command failed:', error.message);
      // Try short hostname as fallback
      try {
        const hostnameResult = await sshService.executeCommand(server, 'hostname', { allowFailure: true });
        results.hostname = (hostnameResult && hostnameResult.stdout) ? hostnameResult.stdout.trim() : 'Unknown';
      } catch (fallbackError) {
        logger.debug('Short hostname command also failed:', fallbackError.message);
        results.hostname = 'Unknown';
      }
    }

    // CPU info
    try {
      const cpuCoresResult = await sshService.executeCommand(server, 'nproc', { allowFailure: true });
      results.cpuCores = (cpuCoresResult && cpuCoresResult.stdout) ? cpuCoresResult.stdout.trim() : 'Unknown';
    } catch (error) {
      logger.debug('CPU cores command failed:', error.message);
      results.cpuCores = 'Unknown';
    }

    try {
      const cpuModelResult = await sshService.executeCommand(server, 'cat /proc/cpuinfo | grep "model name" | head -1', { allowFailure: true });
      if (cpuModelResult && cpuModelResult.stdout) {
        const modelLine = cpuModelResult.stdout.trim();
        results.cpuModel = modelLine ? (modelLine.split(':')[1]?.trim() || 'Unknown') : 'Unknown';
      } else {
        results.cpuModel = 'Unknown';
      }
    } catch (error) {
      logger.debug('CPU model command failed:', error.message);
      results.cpuModel = 'Unknown';
    }

    // Memory info - using simpler commands
    try {
      const memResult = await sshService.executeCommand(server, 'free -h', { allowFailure: true });
      if (memResult && memResult.stdout) {
        const memLines = memResult.stdout.split('\n');
        const memLine = memLines.find(line => line.includes('Mem:'));
        if (memLine) {
          const parts = memLine.split(/\s+/);
          results.totalMemory = parts[1] || 'Unknown';
          results.usedMemory = parts[2] || 'Unknown';
          results.availableMemory = parts[6] || parts[3] || 'Unknown';
        } else {
          results.totalMemory = 'Unknown';
          results.usedMemory = 'Unknown';
          results.availableMemory = 'Unknown';
        }
      } else {
        results.totalMemory = 'Unknown';
        results.usedMemory = 'Unknown';
        results.availableMemory = 'Unknown';
      }
    } catch (error) {
      logger.debug('Memory command failed:', error.message);
      results.totalMemory = 'Unknown';
      results.usedMemory = 'Unknown';
      results.availableMemory = 'Unknown';
    }

    // Disk usage
    try {
      const diskResult = await sshService.executeCommand(server, 'df -h /', { allowFailure: true });
      if (diskResult && diskResult.stdout) {
        const diskLines = diskResult.stdout.split('\n');
        if (diskLines.length > 1) {
          const parts = diskLines[1].split(/\s+/);
          if (parts.length >= 5) {
            results.diskUsage = `${parts[2]} / ${parts[1]} (${parts[4]} used)`;
          } else {
            results.diskUsage = 'Unknown';
          }
        } else {
          results.diskUsage = 'Unknown';
        }
      } else {
        results.diskUsage = 'Unknown';
      }
    } catch (error) {
      logger.debug('Disk usage command failed:', error.message);
      results.diskUsage = 'Unknown';
    }

    // Uptime
    try {
      const uptimeResult = await sshService.executeCommand(server, 'uptime -p', { allowFailure: true });
      if (uptimeResult && uptimeResult.code === 0 && uptimeResult.stdout && uptimeResult.stdout.trim()) {
        results.uptime = uptimeResult.stdout.trim();
      } else {
        // Fallback to regular uptime
        try {
          const uptimeFallback = await sshService.executeCommand(server, 'uptime', { allowFailure: true });
          if (uptimeFallback && uptimeFallback.stdout) {
            const uptimeStr = uptimeFallback.stdout.trim();
            const match = uptimeStr.match(/up\s+(.+?)(?:,\s+\d+\s+users)?/);
            results.uptime = match ? match[1].trim() : 'Unknown';
          } else {
            results.uptime = 'Unknown';
          }
        } catch {
          results.uptime = 'Unknown';
        }
      }
    } catch (error) {
      logger.debug('Uptime command failed:', error.message);
      results.uptime = 'Unknown';
    }

    // Docker version
    try {
      const dockerResult = await sshService.executeCommand(server, 'docker --version', { allowFailure: true });
      results.dockerVersion = (dockerResult && dockerResult.stdout) ? dockerResult.stdout.trim() : 'Unknown';
    } catch (error) {
      logger.debug('Docker version command failed:', error.message);
      results.dockerVersion = 'Unknown';
    }

    // CPU usage - simplified
    try {
      const cpuUsageResult = await sshService.executeCommand(server, "grep '^cpu ' /proc/stat | awk '{usage=($2+$4)*100/($2+$4+$5)} END {print usage}'", { allowFailure: true });
      if (cpuUsageResult && cpuUsageResult.stdout) {
        const cpuUsage = parseFloat(cpuUsageResult.stdout.trim());
        results.cpuUsage = !isNaN(cpuUsage) ? `${cpuUsage.toFixed(1)}%` : 'Unknown';
      } else {
        results.cpuUsage = 'Unknown';
      }
    } catch (error) {
      logger.debug('CPU usage command failed:', error.message);
      results.cpuUsage = 'Unknown';
    }

    // Load average
    try {
      const loadResult = await sshService.executeCommand(server, 'cat /proc/loadavg', { allowFailure: true });
      if (loadResult && loadResult.stdout) {
        const parts = loadResult.stdout.trim().split(/\s+/);
        if (parts.length >= 3) {
          results.loadAverage = `${parts[0]} ${parts[1]} ${parts[2]}`;
        } else {
          results.loadAverage = 'Unknown';
        }
      } else {
        results.loadAverage = 'Unknown';
      }
    } catch (error) {
      logger.debug('Load average command failed:', error.message);
      results.loadAverage = 'Unknown';
    }

    return results;
  }

  async getSnapshotsForContainer(server, containerId) {
    // Get container details to extract the container name
    let containerName = '';
    try {
      const containerDetails = await this.getContainerDetails(server, containerId);
      // Extract container name - Docker returns it with leading slash
      containerName = containerDetails.Name?.replace(/^\//, '') || 
                      containerDetails.Name || 
                      containerDetails.Config?.Hostname || 
                      '';
      
      // Also try alternative name fields
      if (!containerName) {
        containerName = containerDetails.Config?.Labels?.['com.docker.compose.service'] ||
                       containerDetails.Config?.Labels?.['io.kubernetes.container.name'] ||
                       '';
      }
      
      logger.debug(`Container name extracted for ${containerId}: "${containerName}"`);
    } catch (error) {
      logger.error('Failed to get container details for snapshot filtering:', error);
    }

    if (!containerName) {
      logger.warn(`Could not extract container name for ${containerId}, returning empty snapshots list`);
      return [];
    }

    // Get all images
    const command = `docker images --format '{{.Repository}}:{{.Tag}}|{{.ID}}|{{.CreatedAt}}'`;
    const result = await sshService.executeCommand(server, command, { allowFailure: true });
    
    if (!result.stdout.trim()) {
      logger.debug('No images found on server');
      return [];
    }

    const lines = result.stdout.trim().split('\n').filter(line => line.trim());
    const images = [];
    
    // Normalize container name for matching (lowercase, no special chars)
    const normalizedContainerName = containerName.toLowerCase().trim();
    const snapshotPrefix = `${normalizedContainerName}-snapshot`;
    
    logger.debug(`Looking for snapshots with prefix: "${snapshotPrefix}"`);
    logger.debug(`Total images to check: ${lines.length}`);
    
    for (const line of lines) {
      const parts = line.split('|');
      if (parts.length >= 3) {
        const fullImageName = parts[0]; // Format: repository:tag
        const [repository, tag] = fullImageName.split(':');
        const normalizedRepository = repository.toLowerCase().trim();
        const normalizedFullName = fullImageName.toLowerCase();
        
        // Check if repository matches the pattern: <containerName>-snapshot
        // The repository should start with the snapshot prefix
        // Examples: "dispatcharr-snapshot" or "dispatcharr-snapshot-v1" should match
        const matchesRepository = normalizedRepository === snapshotPrefix || 
                                  normalizedRepository.startsWith(`${snapshotPrefix}-`) ||
                                  normalizedRepository.startsWith(`${snapshotPrefix}:`);
        
        // Also check the full image name as fallback (repository:tag format)
        const matchesFullName = normalizedFullName.startsWith(`${snapshotPrefix}:`) ||
                               normalizedFullName.startsWith(`${snapshotPrefix}-`);
        
        if (matchesRepository || matchesFullName) {
          logger.debug(`Found matching snapshot: ${fullImageName} (repository: ${repository}, matches: ${matchesRepository || matchesFullName})`);
          images.push({
            name: fullImageName,
            id: parts[1],
            created: parts[2],
          });
        } else {
          logger.debug(`Skipping image ${fullImageName} (repository: ${repository}, expected prefix: ${snapshotPrefix})`);
        }
      }
    }

    logger.debug(`Returning ${images.length} snapshots for container ${containerName}`);
    return images;
  }

  async createContainerFromImage(server, imageName, containerName, options = {}) {
    // Create a new container from an image
    // docker create --name containerName imageName
    let command = `docker create`;
    
    if (containerName) {
      command += ` --name ${containerName}`;
    }
    
    // Add port mappings if provided
    if (options.ports && options.ports.length > 0) {
      options.ports.forEach(port => {
        command += ` -p ${port}`;
      });
    }
    
    // Add environment variables if provided
    if (options.env && options.env.length > 0) {
      options.env.forEach(env => {
        command += ` -e ${env}`;
      });
    }
    
    // Add restart policy
    if (options.restart) {
      command += ` --restart=${options.restart}`;
    }
    
    command += ` ${imageName}`;
    
    const result = await sshService.executeCommand(server, command, { allowFailure: true });
    
    if (result.code !== 0) {
      throw new Error(`Failed to create container: ${result.stderr || result.stdout}`);
    }
    
    // Extract container ID from output
    const containerId = result.stdout.trim();
    
    return {
      success: true,
      containerId: containerId,
      message: `Container created from image ${imageName}`,
    };
  }
}

module.exports = new DockerService();
