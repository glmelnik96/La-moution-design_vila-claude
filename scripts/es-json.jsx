// ES3 JSON.stringify polyfill for After Effects ExtendScript.
// Prepended to every payload by ae.js so jsx can `return JSON.stringify(obj)`.
if (typeof JSON === "undefined") { JSON = {}; }
if (typeof JSON.stringify !== "function") {
  JSON.stringify = function (value) {
    function quote(s) {
      var c, i, len = s.length, out = '"';
      for (i = 0; i < len; i += 1) {
        c = s.charAt(i);
        if (c === '"' || c === '\\') { out += '\\' + c; }
        else if (c === '\n') { out += '\\n'; }
        else if (c === '\r') { out += '\\r'; }
        else if (c === '\t') { out += '\\t'; }
        else if (c < ' ') { out += '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4); }
        else { out += c; }
      }
      return out + '"';
    }
    function str(val) {
      var t = typeof val, i, parts;
      if (val === null || val === undefined) { return 'null'; }
      if (t === 'number') { return isFinite(val) ? String(val) : 'null'; }
      if (t === 'boolean') { return String(val); }
      if (t === 'string') { return quote(val); }
      if (t === 'object') {
        parts = [];
        if (val instanceof Array) {
          for (i = 0; i < val.length; i += 1) { parts.push(str(val[i])); }
          return '[' + parts.join(',') + ']';
        }
        for (i in val) { if (val.hasOwnProperty(i)) { parts.push(quote(i) + ':' + str(val[i])); } }
        return '{' + parts.join(',') + '}';
      }
      return 'null';
    }
    return str(value);
  };
}
