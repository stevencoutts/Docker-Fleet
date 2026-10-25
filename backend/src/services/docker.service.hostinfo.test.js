const test = require('node:test');
const assert = require('node:assert');
const { splitSections, parseHostStatic, parseHostDynamic } = require('./docker.service');

const STATIC_OUT = [
  '@@arch', 'x86_64',
  '@@kernel', '6.1.0-54-amd64',
  '@@os', 'Linux',
  '@@fqdn', 'mule.couttsnet.com',
  '@@hostname', 'mule',
  '@@nproc', '4',
  '@@cpumodel', 'model name\t: Intel(R) N100',
  '@@docker', 'Docker version 28.5.1, build e180ab8',
  '@@publicip', '203.0.113.7',
].join('\n');

const DYNAMIC_OUT = [
  '@@mem',
  '               total        used        free      shared  buff/cache   available',
  'Mem:            15Gi       6.1Gi       1.2Gi       120Mi       8.3Gi       9.0Gi',
  'Swap:          976Mi          0B       976Mi',
  '@@dfb', '485331099648 86125907968 19',
  '@@dfk', '485331099648 86125907968 19',
  '@@dfh', 'Filesystem      Size  Used Avail Use% Mounted on', '/dev/sda2       452G   81G  349G  19% /',
  '@@uptimep', 'up 3 days, 4 hours',
  '@@uptime', ' 19:30:01 up 3 days,  4:00,  1 user,  load average: 1.50, 1.20, 1.10',
  '@@cpu', '23.4',
  '@@load', '1.50 1.20 1.10 2/612 12345',
].join('\n');

test('splitSections splits marker output and strips CR from pty output', () => {
  const sec = splitSections('@@a\r\none\r\ntwo\r\n@@b\r\n\r\n@@c\r\nthree\r\n');
  assert.deepStrictEqual(sec, { a: 'one\ntwo', b: '', c: 'three' });
});

test('splitSections tolerates empty or missing output', () => {
  assert.deepStrictEqual(splitSections(''), {});
  assert.deepStrictEqual(splitSections(undefined), {});
});

test('parseHostStatic maps every static field', () => {
  assert.deepStrictEqual(parseHostStatic(splitSections(STATIC_OUT)), {
    architecture: 'x86_64',
    kernel: '6.1.0-54-amd64',
    os: 'Linux',
    hostname: 'mule.couttsnet.com',
    cpuCores: '4',
    cpuModel: 'Intel(R) N100',
    dockerVersion: 'Docker version 28.5.1, build e180ab8',
    publicIp: '203.0.113.7',
  });
});

test('parseHostStatic falls back to short hostname, Unknown, and drops a bad public IP', () => {
  const info = parseHostStatic(splitSections('@@fqdn\n@@hostname\nmule\n@@publicip\n<html>error</html>'));
  assert.strictEqual(info.hostname, 'mule');
  assert.strictEqual(info.architecture, 'Unknown');
  assert.strictEqual(info.cpuModel, 'Unknown');
  assert.ok(!('publicIp' in info));
});

test('parseHostDynamic maps memory, disk, uptime, cpu and load', () => {
  const info = parseHostDynamic(splitSections(DYNAMIC_OUT));
  assert.strictEqual(info.totalMemory, '15Gi');
  assert.strictEqual(info.usedMemory, '6.1Gi');
  assert.strictEqual(info.availableMemory, '9.0Gi');
  assert.strictEqual(info.rootDiskTotalBytes, 485331099648);
  assert.strictEqual(info.rootDiskUsedBytes, 86125907968);
  assert.strictEqual(info.rootDiskUsePercent, 19);
  assert.match(info.diskUsage, /\(19%\)$/);
  assert.strictEqual(info.uptime, 'up 3 days, 4 hours');
  assert.strictEqual(info.cpuUsage, '23.4%');
  assert.strictEqual(info.loadAverage, '1.50 1.20 1.10');
});

test('parseHostDynamic falls back to df -h when byte df output is missing', () => {
  const info = parseHostDynamic(splitSections('@@dfb\n@@dfk\n@@dfh\nFilesystem Size Used Avail Use% Mounted\n/dev/sda2 452G 81G 349G 19% /'));
  assert.strictEqual(info.diskUsage, '81G / 452G (19%)');
  assert.strictEqual(info.rootDiskUsePercent, 19);
});

test('parseHostDynamic reports Unknown for everything when the command failed', () => {
  const info = parseHostDynamic({});
  for (const k of ['totalMemory', 'usedMemory', 'availableMemory', 'diskUsage', 'uptime', 'cpuUsage', 'loadAverage']) {
    assert.strictEqual(info[k], 'Unknown', k);
  }
});
