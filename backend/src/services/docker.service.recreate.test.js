const test = require('node:test');
const assert = require('node:assert');
const { getComposeContextFromInspect, buildNetworkingForRecreate } = require('./docker.service');

function composeDetails(overrides = {}) {
  return {
    Id: 'abcdef123456abcdef123456abcdef123456abcdef123456abcdef123456abcd',
    Name: '/stocks-postgres-1',
    Config: {
      Labels: {
        'com.docker.compose.project': 'stocks',
        'com.docker.compose.service': 'postgres',
        'com.docker.compose.project.working_dir': '/opt/dockerfleet/stacks/stocks',
        'com.docker.compose.project.config_files': '/opt/dockerfleet/stacks/stocks/compose.yaml',
        ...overrides.labels,
      },
    },
    HostConfig: { NetworkMode: overrides.networkMode ?? 'stocks_default' },
    NetworkSettings: {
      Networks: overrides.networks ?? {
        stocks_default: { Aliases: ['postgres', 'abcdef123456'] },
      },
    },
  };
}

test('getComposeContextFromInspect extracts project context from labels', () => {
  const ctx = getComposeContextFromInspect(composeDetails());
  assert.strictEqual(ctx.project, 'stocks');
  assert.strictEqual(ctx.service, 'postgres');
  assert.strictEqual(ctx.workingDir, '/opt/dockerfleet/stacks/stocks');
  assert.deepStrictEqual(ctx.configFiles, ['/opt/dockerfleet/stacks/stocks/compose.yaml']);
});

test('getComposeContextFromInspect returns null for non-compose containers', () => {
  assert.strictEqual(getComposeContextFromInspect({ Config: { Labels: {} } }), null);
  assert.strictEqual(getComposeContextFromInspect({}), null);
});

test('getComposeContextFromInspect rejects unsafe label values', () => {
  const bad = composeDetails({ labels: { 'com.docker.compose.project.working_dir': '/opt; rm -rf /' } });
  // semicolon is fine in a quoted path, but backticks/$ and traversal are not
  const traversal = composeDetails({ labels: { 'com.docker.compose.project.working_dir': '/opt/../etc' } });
  assert.strictEqual(getComposeContextFromInspect(traversal), null);
  const injection = composeDetails({ labels: { 'com.docker.compose.project.config_files': '/tmp/$(reboot).yaml' } });
  assert.strictEqual(getComposeContextFromInspect(injection), null);
  const badProject = composeDetails({ labels: { 'com.docker.compose.project': 'x y' } });
  assert.strictEqual(getComposeContextFromInspect(badProject), null);
  assert.ok(getComposeContextFromInspect(bad) !== undefined);
});

test('buildNetworkingForRecreate preserves compose service aliases', () => {
  const { networkingConfig, extraNetworks } = buildNetworkingForRecreate(composeDetails());
  assert.deepStrictEqual(networkingConfig, {
    EndpointsConfig: { stocks_default: { Aliases: ['postgres'] } },
  });
  assert.deepStrictEqual(extraNetworks, []);
});

test('buildNetworkingForRecreate drops old container id and name aliases', () => {
  const details = composeDetails({
    networks: { stocks_default: { Aliases: ['postgres', 'abcdef123456', 'stocks-postgres-1'] } },
  });
  const { networkingConfig } = buildNetworkingForRecreate(details);
  assert.deepStrictEqual(networkingConfig.EndpointsConfig.stocks_default.Aliases, ['postgres']);
});

test('buildNetworkingForRecreate lists extra networks for reconnection', () => {
  const details = composeDetails({
    networks: {
      stocks_default: { Aliases: ['postgres'] },
      shared_net: { Aliases: ['db', 'abcdef123456'] },
    },
  });
  const { networkingConfig, extraNetworks } = buildNetworkingForRecreate(details);
  assert.ok(networkingConfig.EndpointsConfig.stocks_default);
  assert.deepStrictEqual(extraNetworks, [{ name: 'shared_net', aliases: ['db'] }]);
});

test('buildNetworkingForRecreate skips host/none/container network modes', () => {
  for (const mode of ['host', 'none', 'container:abc123']) {
    const { networkingConfig, extraNetworks } = buildNetworkingForRecreate(composeDetails({ networkMode: mode }));
    assert.strictEqual(networkingConfig, null);
    assert.deepStrictEqual(extraNetworks, []);
  }
});

test('buildNetworkingForRecreate sends no aliases on the default bridge', () => {
  const details = composeDetails({
    networkMode: 'bridge',
    networks: { bridge: { Aliases: ['abcdef123456'] } },
  });
  const { networkingConfig } = buildNetworkingForRecreate(details);
  assert.deepStrictEqual(networkingConfig, { EndpointsConfig: { bridge: {} } });
});
