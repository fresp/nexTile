// Mock Gio namespace
import { withSignals } from "../helpers/signalMixin.js";

export class File {
  constructor(path) {
    this.path = path;
    // Permission model so tests can exercise read-only stylesheet handling (Bug #312).
    this._writable = true;
    this._mode = 0o644;
  }

  static new_for_path(path) {
    return new File(path);
  }

  get_path() {
    return this.path;
  }

  get_parent() {
    const parts = this.path.split("/");
    parts.pop();
    return new File(parts.join("/"));
  }

  get_child(name) {
    return new File(`${this.path}/${name}`);
  }

  query_exists(cancellable) {
    // Mock - assume files exist
    return true;
  }

  make_directory_with_parents(cancellable) {
    // Mock directory creation
    return true;
  }

  load_contents(cancellable) {
    // Mock file loading - return empty content. Real Gio hands back a Uint8Array
    // (GLib.Bytes data), so decode via TextDecoder works; returning a bare string
    // here would diverge from production.
    return [true, new TextEncoder().encode(""), null];
  }

  replace_contents(contents, etag, make_backup, flags, cancellable) {
    // Mock file writing — fails on a read-only file, like the real Gio (Bug #312).
    return this._writable ? [true, null] : [false, null];
  }

  copy(destination, flags, cancellable, progressCallback) {
    // Model Gio's perm handling: by default a copy preserves the source's mode;
    // TARGET_DEFAULT_PERMS makes the destination use the (writable) umask default.
    // Like Gio, an OVERWRITE copy onto an existing read-only file fails (nextile-3pnu).
    if (destination && typeof destination === "object") {
      if (destination.query_exists(null) && !destination._writable) {
        throw new Error(`Error opening file "${destination.path}": Permission denied`);
      }
      if ((flags & FileCopyFlags.TARGET_DEFAULT_PERMS) !== 0) {
        destination._writable = true;
        destination._mode = 0o644;
      } else {
        destination._writable = this._writable;
        destination._mode = this._mode;
      }
    }
    return true;
  }

  set_attribute_uint32(attribute, value, flags, cancellable) {
    if (attribute === "unix::mode") {
      this._mode = value;
      this._writable = (value & 0o200) !== 0; // owner-write bit
    }
    return true;
  }

  create(flags, cancellable) {
    // Mock file creation - return a mock output stream
    return {
      write_all: (contents, cancellable) => {
        // Mock write operation
        return [true, contents.length];
      },
      close: (cancellable) => true,
    };
  }
}

export class Settings extends withSignals() {
  constructor(schema_id) {
    super();
    this.schema_id = schema_id;
    this._settings = new Map();
  }

  static new(schema_id) {
    return new Settings(schema_id);
  }

  get_boolean(key) {
    return this._settings.get(key) || false;
  }

  set_boolean(key, value) {
    this._settings.set(key, value);
  }

  get_int(key) {
    return this._settings.get(key) || 0;
  }

  set_int(key, value) {
    this._settings.set(key, value);
  }

  get_string(key) {
    return this._settings.get(key) || "";
  }

  set_string(key, value) {
    this._settings.set(key, value);
  }

  get_strv(key) {
    return this._settings.get(key) || [];
  }

  set_strv(key, value) {
    this._settings.set(key, value);
  }

  get_uint(key) {
    return this._settings.get(key) || 0;
  }

  set_uint(key, value) {
    this._settings.set(key, value);
  }

  get_value(key) {
    return this._settings.get(key);
  }

  set_value(key, value) {
    this._settings.set(key, value);
  }
}

export const FileCreateFlags = {
  NONE: 0,
  PRIVATE: 1 << 0,
  REPLACE_DESTINATION: 1 << 1,
};

export const FileQueryInfoFlags = {
  NONE: 0,
  NOFOLLOW_SYMLINKS: 1 << 0,
};

export const FileCopyFlags = {
  NONE: 0,
  OVERWRITE: 1 << 0,
  BACKUP: 1 << 1,
  NOFOLLOW_SYMLINKS: 1 << 2,
  ALL_METADATA: 1 << 3,
  NO_FALLBACK_FOR_MOVE: 1 << 4,
  TARGET_DEFAULT_PERMS: 1 << 5,
};

// The session bus connection extensions export objects on.
export const DBus = { session: { _name: "session-bus" } };

// Gio.DBusExportedObject as GJS provides it: wrapJSObject() pairs an interface
// with the JS object implementing it. Tests read `exports` to see what is live
// on the bus and call the wrapped object's methods directly.
export class DBusExportedObject {
  static exports = new Map();

  static wrapJSObject(interfaceXml, jsObject) {
    return new DBusExportedObject(interfaceXml, jsObject);
  }

  constructor(interfaceXml, jsObject) {
    this.interfaceXml = interfaceXml;
    this.jsObject = jsObject;
    this._path = null;
  }

  export(connection, path) {
    if (DBusExportedObject.exports.has(path)) {
      throw new Error(`An object is already exported at ${path}`);
    }
    this._path = path;
    DBusExportedObject.exports.set(path, this);
  }

  unexport() {
    if (this._path) DBusExportedObject.exports.delete(this._path);
    this._path = null;
  }
}

export default {
  File,
  DBus,
  DBusExportedObject,
  Settings,
  FileCreateFlags,
  FileCopyFlags,
  FileQueryInfoFlags,
};
