/**
 * Validation and escaping for values passed into shell commands to prevent injection.
 * Use these for any user- or route-controlled input that reaches SSH-executed commands.
 */

// Docker container/image IDs: hex, 1-64 chars
const DOCKER_ID_REGEX = /^[a-fA-F0-9]{1,64}$/;
// Docker image name: alphanumeric, / . - _ : (repository/name, name:tag)
const IMAGE_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.\-/:]*$/;
const IMAGE_NAME_MAX_LEN = 255;
// Docker tag: alphanumeric, . - _
const TAG_REGEX = /^[a-zA-Z0-9_.\-]{1,128}$/;
// Port: single port or hostPort:containerPort
const PORT_REGEX = /^\d{1,5}$|^\d{1,5}:\d{1,5}$/;
const ALLOWED_SHELLS = ['/bin/sh', '/bin/bash'];

function throwInvalid(message, value) {
  const err = new Error(message);
  err.code = 'INVALID_INPUT';
  err.exposed = true;
  throw err;
}

/**
 * Validate Docker container or image ID (hex string).
 */
function validateContainerId(id) {
  if (typeof id !== 'string' || !id.trim()) throwInvalid('Invalid container ID', id);
  const trimmed = id.trim();
  if (!DOCKER_ID_REGEX.test(trimmed)) throwInvalid('Invalid container ID format', id);
  return trimmed;
}

/**
 * Alias for image IDs (same format as container ID).
 */
function validateImageId(id) {
  if (typeof id !== 'string' || !id.trim()) throwInvalid('Invalid image ID', id);
  const trimmed = id.trim();
  if (!DOCKER_ID_REGEX.test(trimmed)) throwInvalid('Invalid image ID format', id);
  return trimmed;
}

/**
 * Validate shell path: allowlist only.
 */
function validateShell(shell) {
  if (shell == null || shell === '') return '/bin/sh';
  const s = String(shell).trim();
  if (!ALLOWED_SHELLS.includes(s)) throwInvalid('Invalid shell', shell);
  return s;
}

/**
 * Validate Docker image name (repository/name or name, optional :tag not included here).
 */
function validateImageName(name) {
  if (typeof name !== 'string' || !name.trim()) throwInvalid('Image name is required', name);
  const trimmed = name.trim();
  if (trimmed.length > IMAGE_NAME_MAX_LEN) throwInvalid('Image name too long', name);
  if (!IMAGE_NAME_REGEX.test(trimmed)) throwInvalid('Invalid image name format', name);
  return trimmed;
}

/**
 * Validate Docker tag.
 */
function validateTag(tag) {
  if (tag == null || tag === '') return 'latest';
  const t = String(tag).trim();
  if (!TAG_REGEX.test(t)) throwInvalid('Invalid tag format', tag);
  return t;
}

/**
 * Validate a single port mapping (e.g. "8080" or "8080:80").
 */
function validatePortMapping(port) {
  if (typeof port !== 'string' && typeof port !== 'number') throwInvalid('Invalid port', port);
  const p = String(port).trim();
  if (!PORT_REGEX.test(p)) throwInvalid('Invalid port format', port);
  return p;
}

/**
 * Validate a file path for export (must be under /tmp, safe chars, end .tar).
 */
function validateExportPath(path) {
  if (typeof path !== 'string' || !path.trim()) throwInvalid('Output path is required', path);
  const p = path.trim();
  if (!/^\/tmp\/[a-zA-Z0-9_.\-]+\.tar$/.test(p)) throwInvalid('Invalid export path', path);
  return p;
}

/**
 * Escape a string for safe use inside single-quoted shell argument.
 * Use for any user-controlled string that is passed as one argument.
 */
function escapeSingleQuoted(arg) {
  if (arg == null) return "''";
  return "'" + String(arg).replace(/'/g, "'\\''") + "'";
}

module.exports = {
  validateContainerId,
  validateImageId,
  validateShell,
  validateImageName,
  validateTag,
  validatePortMapping,
  validateExportPath,
  escapeSingleQuoted,
  DOCKER_ID_REGEX,
  IMAGE_NAME_REGEX,
  TAG_REGEX,
  PORT_REGEX,
};
