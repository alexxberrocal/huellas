/* Huellas · arranca el worker de importación (desde un Blob: funciona también sin servidor). */
(function () {
  'use strict';
  const H = (window.H = window.H || {});

  H.Engine = class Engine {
    constructor() { this.worker = null; this.ready = null; this.busy = false; }

    start() {
      if (this.ready) return this.ready;
      this.ready = new Promise((resolve, reject) => {
        let url;
        try {
          const src = '(' + window.HuellasWorker.toString() + ')()';
          url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
          this.worker = new Worker(url);
        } catch (err) {
          reject(new Error('Tu navegador no permite procesar archivos en segundo plano. Prueba con Chrome, Edge o Firefox actualizados.'));
          return;
        }
        this.worker.onmessage = (e) => { if (e.data.type === 'ready') { URL.revokeObjectURL(url); resolve(); } };
        this.worker.onerror = (e) => { e.preventDefault(); this.reset(); reject(new Error('No se pudo iniciar el procesador: ' + (e.message || 'error desconocido'))); };
        this.worker.postMessage({ type: 'init', countries: window.HUELLAS_COUNTRIES, cities: window.HUELLAS_CITIES });
      });
      return this.ready;
    }

    reset() {
      if (this.worker) this.worker.terminate();
      this.worker = null; this.ready = null; this.busy = false;
    }

    async run(files, onProgress) {
      await this.start();
      this.busy = true;
      return new Promise((resolve, reject) => {
        const w = this.worker;
        w.onmessage = (e) => {
          const m = e.data;
          if (m.type === 'progress') { if (onProgress) onProgress(m); }
          else if (m.type === 'done') { this.busy = false; resolve(m.ds); }
          else if (m.type === 'error') { this.busy = false; reject(new Error(m.msg)); }
        };
        w.onerror = (e) => {
          e.preventDefault();
          this.reset();
          reject(new Error('El procesador se detuvo (' + (e.message || 'posible falta de memoria') + '). Si el archivo es enorme, cierra otras pestañas y vuelve a intentarlo.'));
        };
        w.postMessage({ type: 'import', files: Array.from(files) });
      });
    }
  };
})();
