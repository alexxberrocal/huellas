/* Huellas · guarda los datos ya procesados en este navegador (IndexedDB), para no reimportar cada vez.
 * Nada sale del equipo; se borra desde Ajustes. Si el navegador no deja guardar, la app sigue igual. */
(function () {
  'use strict';
  const H = (window.H = window.H || {});
  const DB = 'huellas', STORE = 'data', KEY = 'dataset';

  function open() {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('bloqueado'));
    });
  }
  function tx(mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const st = t.objectStore(STORE);
      const r = fn(st);
      t.oncomplete = () => { db.close(); resolve(r && r.result); };
      t.onerror = () => { db.close(); reject(t.error); };
      t.onabort = () => { db.close(); reject(t.error || new Error('cancelado')); };
    }));
  }

  H.store = {
    async save(ds) {
      try {
        await tx('readwrite', (st) => st.put(ds, KEY));
        H.storage.set('saved', { at: Date.now(), points: ds.meta.points, from: ds.days.day0, to: ds.days.day0 + ds.days.n - 1 });
        return true;
      } catch (e) {
        console.warn('No se pudieron guardar los datos en el navegador:', e);
        return false;
      }
    },
    async load() {
      try {
        const ds = await tx('readonly', (st) => st.get(KEY));
        return ds && ds.version === 4 ? ds : null;
      } catch (e) {
        return null;
      }
    },
    async clear() {
      try { await tx('readwrite', (st) => st.delete(KEY)); } catch (e) { /* nada que borrar */ }
      H.storage.set('saved', null);
    },
    info() { return H.storage.get('saved', null); },
  };
})();
