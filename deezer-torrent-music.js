/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           LAMPA MUSIC TORRENT PLUGIN v1.0.0                  ║
 * ║   Музыка через торрент + метаданные из Deezer API            ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Установка: Lampa → Настройки → Плагины → Добавить URL
 * Требует: WebTorrent или встроенный торрент-движок Lampa
 */

(function () {
  'use strict';

  /* ─────────────────────────── КОНФИГ ─────────────────────────── */
  var PLUGIN_ID   = 'music_torrent';
  var PLUGIN_NAME = 'Музыка (Торрент)';
  var DEEZER_API  = 'https://api.deezer.com';
  var CORS_PROXY  = 'https://corsproxy.io/?';   // можно заменить на свой прокси

  /* ──────────────────────── ВСПОМОГАТЕЛЬНЫЕ ──────────────────── */
  function deezerGet(path, params) {
    var qs = Object.keys(params || {}).map(function (k) {
      return k + '=' + encodeURIComponent(params[k]);
    }).join('&');
    var url = CORS_PROXY + encodeURIComponent(DEEZER_API + path + (qs ? '?' + qs : ''));
    return new Promise(function (resolve, reject) {
      fetch(url)
        .then(function (r) { return r.json(); })
        .then(resolve)
        .catch(reject);
    });
  }

  function secondsToTime(s) {
    var m = Math.floor(s / 60);
    var sec = s % 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function pad(n) { return n < 10 ? '0' + n : n; }

  /* ──────────────────────── СТОР (in-memory) ─────────────────── */
  var Store = {
    _data: {},
    get: function (key, def) {
      try { return JSON.parse(localStorage.getItem(PLUGIN_ID + '_' + key)) || def; }
      catch (e) { return def; }
    },
    set: function (key, val) {
      try { localStorage.setItem(PLUGIN_ID + '_' + key, JSON.stringify(val)); }
      catch (e) {}
    }
  };

  /* ──────────────────────── PLAYER STATE ─────────────────────── */
  var Player = {
    audio: null,
    queue: [],
    index: 0,
    torrentMagnet: '',
    shuffle: false,
    repeat: false,       // 'none' | 'one' | 'all'
    _onUpdate: [],

    on: function (fn) { this._onUpdate.push(fn); },
    emit: function () { this._onUpdate.forEach(function (fn) { fn(); }); },

    setQueue: function (tracks, idx) {
      this.queue = tracks;
      this.index = idx || 0;
    },

    current: function () { return this.queue[this.index] || null; },

    play: function (track) {
      var self = this;
      if (this.audio) {
        this.audio.pause();
        this.audio.src = '';
      }
      if (!track || !track.preview) return;
      this.audio = new Audio(track.preview);
      this.audio.volume = Store.get('volume', 0.8);
      this.audio.play().catch(function () {});
      this.audio.ontimeupdate = function () { self.emit(); };
      this.audio.onended = function () { self.next(); };
      this.emit();
    },

    playIndex: function (i) {
      this.index = i;
      this.play(this.current());
    },

    next: function () {
      if (this.shuffle) {
        this.index = Math.floor(Math.random() * this.queue.length);
      } else if (this.index < this.queue.length - 1) {
        this.index++;
      } else {
        this.index = 0;
      }
      this.play(this.current());
    },

    prev: function () {
      if (this.index > 0) this.index--;
      else this.index = this.queue.length - 1;
      this.play(this.current());
    },

    pause: function () {
      if (this.audio) {
        if (this.audio.paused) this.audio.play().catch(function(){});
        else this.audio.pause();
        this.emit();
      }
    },

    seek: function (pct) {
      if (this.audio && this.audio.duration) {
        this.audio.currentTime = this.audio.duration * pct;
      }
    },

    setVolume: function (v) {
      if (this.audio) this.audio.volume = v;
      Store.set('volume', v);
    },

    isPlaying: function () {
      return this.audio && !this.audio.paused;
    },

    progress: function () {
      if (!this.audio || !this.audio.duration) return 0;
      return this.audio.currentTime / this.audio.duration;
    },

    currentTime: function () {
      return this.audio ? Math.floor(this.audio.currentTime) : 0;
    }
  };

  /* ──────────────────────────── UI ───────────────────────────── */
  var UI = {
    root: null,
    view: 'home',   // home | search | album | artist | player | torrent

    styles: [
      'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;',
      'background:#0a0a0f;color:#e8e0ff;font-family:"Segoe UI",sans-serif;',
      'display:flex;flex-direction:column;overflow:hidden;'
    ].join(''),

    headerStyle: [
      'display:flex;align-items:center;gap:16px;padding:18px 28px;',
      'background:rgba(255,255,255,.04);border-bottom:1px solid rgba(255,255,255,.08);',
      'flex-shrink:0;'
    ].join(''),

    colors: {
      accent: '#b388ff',
      accentDark: '#7c4dff',
      bg: '#0a0a0f',
      surface: '#13131d',
      border: 'rgba(255,255,255,.1)',
      text: '#e8e0ff',
      muted: '#7b7a8e'
    },

    show: function () {
      if (this.root) return;
      this.root = document.createElement('div');
      this.root.id = PLUGIN_ID + '_ui';
      this.root.style.cssText = this.styles;
      document.body.appendChild(this.root);
      this.injectStyles();
      this.renderHome();
    },

    hide: function () {
      if (this.root) {
        this.root.remove();
        this.root = null;
      }
    },

    injectStyles: function () {
      if (document.getElementById(PLUGIN_ID + '_css')) return;
      var css = document.createElement('style');
      css.id = PLUGIN_ID + '_css';
      css.textContent = [
        '#' + PLUGIN_ID + '_ui * { box-sizing:border-box; }',
        '#' + PLUGIN_ID + '_ui ::-webkit-scrollbar { width:4px; }',
        '#' + PLUGIN_ID + '_ui ::-webkit-scrollbar-thumb { background:#7c4dff;border-radius:2px; }',
        '#' + PLUGIN_ID + '_ui input { background:#1e1e2e;border:1px solid rgba(179,136,255,.3);',
        '  color:#e8e0ff;border-radius:8px;padding:10px 16px;font-size:15px;outline:none;',
        '  transition:border-color .2s; }',
        '#' + PLUGIN_ID + '_ui input:focus { border-color:#b388ff; }',
        '.mt-btn { background:rgba(179,136,255,.15);border:1px solid rgba(179,136,255,.3);',
        '  color:#b388ff;border-radius:8px;padding:9px 18px;cursor:pointer;font-size:13px;',
        '  transition:all .2s;white-space:nowrap; }',
        '.mt-btn:hover { background:rgba(179,136,255,.3);border-color:#b388ff; }',
        '.mt-btn.primary { background:#7c4dff;border-color:#7c4dff;color:#fff; }',
        '.mt-btn.primary:hover { background:#651fff; }',
        '.mt-card { background:#13131d;border:1px solid rgba(255,255,255,.07);border-radius:12px;',
        '  overflow:hidden;cursor:pointer;transition:all .25s; }',
        '.mt-card:hover { border-color:#b388ff;transform:translateY(-2px); }',
        '.mt-track-row { display:flex;align-items:center;gap:12px;padding:10px 14px;',
        '  border-radius:8px;cursor:pointer;transition:background .2s; }',
        '.mt-track-row:hover { background:rgba(179,136,255,.1); }',
        '.mt-track-row.active { background:rgba(124,77,255,.2);border-left:3px solid #b388ff; }',
        '.mt-prog { height:4px;background:rgba(255,255,255,.1);border-radius:2px;',
        '  cursor:pointer;position:relative; }',
        '.mt-prog-fill { height:100%;background:#b388ff;border-radius:2px;',
        '  transition:width .3s linear; }',
        '.mt-tab { padding:8px 20px;border-radius:20px;cursor:pointer;font-size:13px;',
        '  color:#7b7a8e;border:none;background:transparent;transition:all .2s; }',
        '.mt-tab.active { background:rgba(124,77,255,.25);color:#b388ff; }',
        '.mt-section { font-size:11px;font-weight:700;letter-spacing:1.5px;',
        '  color:#7b7a8e;text-transform:uppercase;margin:24px 0 12px; }',
        '@keyframes mt-spin { to { transform:rotate(360deg); } }',
        '.mt-spin { animation:mt-spin 1s linear infinite; }',
        '@keyframes mt-fade { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }',
        '.mt-fade { animation:mt-fade .3s ease; }',
      ].join('\n');
      document.head.appendChild(css);
    },

    el: function (tag, attrs, children) {
      var el = document.createElement(tag);
      Object.keys(attrs || {}).forEach(function (k) {
        if (k === 'style') el.style.cssText = attrs[k];
        else if (k === 'class') el.className = attrs[k];
        else if (k.startsWith('on')) el[k] = attrs[k];
        else el.setAttribute(k, attrs[k]);
      });
      (children || []).forEach(function (c) {
        if (typeof c === 'string') el.appendChild(document.createTextNode(c));
        else if (c) el.appendChild(c);
      });
      return el;
    },

    clear: function () {
      if (this.root) this.root.innerHTML = '';
    },

    /* ─── HEADER ─── */
    makeHeader: function (title, showBack) {
      var self = this;
      var items = [];

      if (showBack) {
        var back = this.el('button', { class: 'mt-btn', onclick: function () { self.renderHome(); } }, ['← Назад']);
        items.push(back);
      }

      var logo = this.el('span', {
        style: 'font-size:18px;font-weight:700;color:#b388ff;letter-spacing:.5px;'
      }, ['🎵 ' + (title || PLUGIN_NAME)]);
      items.push(logo);

      var spacer = this.el('div', { style: 'flex:1;' });
      items.push(spacer);

      var closeBtn = this.el('button', {
        class: 'mt-btn',
        onclick: function () { self.hide(); }
      }, ['✕']);
      items.push(closeBtn);

      return this.el('div', { style: this.headerStyle }, items);
    },

    /* ─── HOME ─── */
    renderHome: function () {
      var self = this;
      this.clear();
      this.view = 'home';

      var content = this.el('div', {
        style: 'flex:1;overflow-y:auto;padding:24px 28px;'
      });

      var header = this.makeHeader();
      this.root.appendChild(header);
      this.root.appendChild(content);

      /* Search bar */
      var searchWrap = this.el('div', { style: 'display:flex;gap:10px;margin-bottom:8px;' });
      var inp = this.el('input', {
        type: 'text',
        placeholder: '🔍  Поиск артиста, альбома, трека...',
        style: 'flex:1;'
      });
      inp.onkeydown = function (e) {
        if (e.key === 'Enter') self.doSearch(inp.value);
      };
      var searchBtn = this.el('button', {
        class: 'mt-btn primary',
        onclick: function () { self.doSearch(inp.value); }
      }, ['Найти']);
      var torrentBtn = this.el('button', {
        class: 'mt-btn',
        onclick: function () { self.renderTorrentInput(); }
      }, ['🧲 Торрент']);
      searchWrap.appendChild(inp);
      searchWrap.appendChild(searchBtn);
      searchWrap.appendChild(torrentBtn);
      content.appendChild(searchWrap);

      /* Charts */
      var chartsTitle = this.el('div', { class: 'mt-section mt-fade' }, ['🔥 Чарт Deezer']);
      content.appendChild(chartsTitle);

      var grid = this.el('div', {
        style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;'
      });
      var spinner = this.el('div', {
        class: 'mt-spin',
        style: 'width:24px;height:24px;border:3px solid #b388ff;border-top-color:transparent;border-radius:50%;margin:20px auto;'
      });
      grid.appendChild(spinner);
      content.appendChild(grid);

      deezerGet('/chart/0/tracks', { limit: 20 }).then(function (data) {
        grid.innerHTML = '';
        var tracks = (data.data || []);
        tracks.forEach(function (track, i) {
          var card = self.makeTrackCard(track, i);
          card.onclick = function () {
            Player.setQueue(tracks, i);
            Player.play(track);
            self.renderPlayer();
          };
          grid.appendChild(card);
        });
        /* Mini player if playing */
        if (Player.current()) self.attachMiniPlayer(content);
      }).catch(function (e) {
        grid.innerHTML = '<div style="color:#7b7a8e;padding:12px;">Не удалось загрузить чарты: ' + e.message + '</div>';
      });
    },

    makeTrackCard: function (track) {
      var cover = (track.album && track.album.cover_medium) || track.artist && track.artist.picture_medium || '';
      var card = this.el('div', { class: 'mt-card mt-fade' });
      if (cover) {
        var img = this.el('img', {
          src: cover,
          style: 'width:100%;aspect-ratio:1;object-fit:cover;'
        });
        card.appendChild(img);
      }
      var info = this.el('div', { style: 'padding:10px;' });
      var title = this.el('div', {
        style: 'font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
      }, [track.title || '—']);
      var artist = this.el('div', {
        style: 'font-size:11px;color:#7b7a8e;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
      }, [track.artist ? track.artist.name : '']);
      info.appendChild(title);
      info.appendChild(artist);
      card.appendChild(info);
      return card;
    },

    /* ─── SEARCH ─── */
    doSearch: function (q) {
      if (!q || !q.trim()) return;
      var self = this;
      this.clear();
      this.view = 'search';

      var content = this.el('div', { style: 'flex:1;overflow-y:auto;padding:24px 28px;' });
      this.root.appendChild(this.makeHeader('Поиск: ' + q, true));
      this.root.appendChild(content);

      var tabs = ['Треки', 'Альбомы', 'Артисты'];
      var activeTab = 0;
      var results = {};

      var tabBar = this.el('div', { style: 'display:flex;gap:6px;margin-bottom:20px;' });
      var resultsArea = this.el('div', {});
      content.appendChild(tabBar);
      content.appendChild(resultsArea);

      function renderTab(idx) {
        activeTab = idx;
        tabBtns.forEach(function (b, i) {
          b.className = 'mt-tab' + (i === idx ? ' active' : '');
        });
        resultsArea.innerHTML = '';

        var key = ['tracks', 'albums', 'artists'][idx];
        if (results[key]) {
          showResults(key, results[key]);
          return;
        }

        var spinner = self.el('div', {
          class: 'mt-spin',
          style: 'width:24px;height:24px;border:3px solid #b388ff;border-top-color:transparent;border-radius:50%;margin:20px auto;'
        });
        resultsArea.appendChild(spinner);

        var paths = ['/search/track', '/search/album', '/search/artist'];
        deezerGet(paths[idx], { q: q, limit: 30 }).then(function (data) {
          results[key] = data.data || [];
          showResults(key, results[key]);
        });
      }

      function showResults(type, items) {
        resultsArea.innerHTML = '';
        if (!items.length) {
          resultsArea.innerHTML = '<div style="color:#7b7a8e;padding:16px;">Ничего не найдено</div>';
          return;
        }
        if (type === 'tracks') {
          var list = self.el('div', {});
          items.forEach(function (track, i) {
            var row = self.makeTrackRow(track, i, items);
            list.appendChild(row);
          });
          resultsArea.appendChild(list);
        } else if (type === 'albums') {
          var grid = self.el('div', {
            style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;'
          });
          items.forEach(function (album) {
            var card = self.makeAlbumCard(album);
            grid.appendChild(card);
          });
          resultsArea.appendChild(grid);
        } else if (type === 'artists') {
          var agrid = self.el('div', {
            style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;'
          });
          items.forEach(function (artist) {
            var card = self.makeArtistCard(artist);
            agrid.appendChild(card);
          });
          resultsArea.appendChild(agrid);
        }
      }

      var tabBtns = tabs.map(function (t, i) {
        var btn = self.el('button', {
          class: 'mt-tab' + (i === 0 ? ' active' : ''),
          onclick: function () { renderTab(i); }
        }, [t]);
        tabBar.appendChild(btn);
        return btn;
      });

      renderTab(0);
    },

    makeTrackRow: function (track, i, queue) {
      var self = this;
      var row = this.el('div', {
        class: 'mt-track-row mt-fade' + (Player.current() && Player.current().id === track.id ? ' active' : '')
      });

      var num = this.el('div', { style: 'width:24px;text-align:right;font-size:12px;color:#7b7a8e;flex-shrink:0;' }, [pad(i + 1)]);
      var cover = '';
      if (track.album && track.album.cover_small) {
        cover = this.el('img', {
          src: track.album.cover_small,
          style: 'width:40px;height:40px;border-radius:6px;object-fit:cover;flex-shrink:0;'
        });
      }
      var info = this.el('div', { style: 'flex:1;min-width:0;' });
      var tit = this.el('div', {
        style: 'font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
      }, [track.title]);
      var art = this.el('div', {
        style: 'font-size:12px;color:#7b7a8e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
      }, [track.artist ? track.artist.name : '']);
      info.appendChild(tit);
      info.appendChild(art);

      var dur = this.el('div', {
        style: 'font-size:12px;color:#7b7a8e;flex-shrink:0;'
      }, [track.duration ? secondsToTime(track.duration) : '']);

      row.appendChild(num);
      if (cover) row.appendChild(cover);
      row.appendChild(info);
      row.appendChild(dur);

      if (!track.preview) {
        row.style.opacity = '0.4';
        row.title = 'Нет превью';
      } else {
        row.onclick = function () {
          Player.setQueue(queue, i);
          Player.play(track);
          self.renderPlayer();
        };
      }
      return row;
    },

    makeAlbumCard: function (album) {
      var self = this;
      var card = this.el('div', { class: 'mt-card mt-fade' });
      if (album.cover_medium) {
        card.appendChild(this.el('img', {
          src: album.cover_medium,
          style: 'width:100%;aspect-ratio:1;object-fit:cover;'
        }));
      }
      var info = this.el('div', { style: 'padding:10px;' });
      info.appendChild(this.el('div', {
        style: 'font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
      }, [album.title]));
      info.appendChild(this.el('div', {
        style: 'font-size:11px;color:#7b7a8e;margin-top:2px;'
      }, [album.artist ? album.artist.name : '']));
      card.appendChild(info);
      card.onclick = function () { self.renderAlbum(album.id); };
      return card;
    },

    makeArtistCard: function (artist) {
      var self = this;
      var card = this.el('div', { class: 'mt-card mt-fade' });
      if (artist.picture_medium) {
        card.appendChild(this.el('img', {
          src: artist.picture_medium,
          style: 'width:100%;aspect-ratio:1;object-fit:cover;'
        }));
      }
      var info = this.el('div', { style: 'padding:10px;text-align:center;' });
      info.appendChild(this.el('div', {
        style: 'font-size:13px;font-weight:600;'
      }, [artist.name]));
      info.appendChild(this.el('div', {
        style: 'font-size:11px;color:#7b7a8e;margin-top:2px;'
      }, [artist.nb_album ? artist.nb_album + ' альб.' : '']));
      card.appendChild(info);
      card.onclick = function () { self.renderArtist(artist.id); };
      return card;
    },

    /* ─── ALBUM ─── */
    renderAlbum: function (id) {
      var self = this;
      this.clear();
      this.view = 'album';

      var content = this.el('div', { style: 'flex:1;overflow-y:auto;padding:24px 28px;' });
      this.root.appendChild(this.makeHeader('Альбом', true));
      this.root.appendChild(content);

      content.innerHTML = '<div style="text-align:center;padding:40px;color:#7b7a8e;">Загрузка...</div>';

      deezerGet('/album/' + id).then(function (album) {
        content.innerHTML = '';

        /* Hero */
        var hero = self.el('div', { style: 'display:flex;gap:24px;margin-bottom:28px;align-items:flex-end;' });
        if (album.cover_big) {
          hero.appendChild(self.el('img', {
            src: album.cover_big,
            style: 'width:180px;height:180px;border-radius:12px;object-fit:cover;flex-shrink:0;box-shadow:0 8px 32px rgba(0,0,0,.6);'
          }));
        }
        var meta = self.el('div', { style: 'flex:1;min-width:0;' });
        meta.appendChild(self.el('div', { style: 'font-size:11px;color:#b388ff;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;' }, ['Альбом']));
        meta.appendChild(self.el('div', { style: 'font-size:26px;font-weight:800;line-height:1.2;margin-bottom:8px;' }, [album.title]));
        meta.appendChild(self.el('div', { style: 'font-size:14px;color:#7b7a8e;margin-bottom:12px;' }, [
          (album.artist ? album.artist.name : '') +
          (album.release_date ? ' · ' + album.release_date.slice(0, 4) : '') +
          (album.nb_tracks ? ' · ' + album.nb_tracks + ' тр.' : '')
        ]));

        var tracks = (album.tracks && album.tracks.data) || [];
        var playBtn = self.el('button', {
          class: 'mt-btn primary',
          onclick: function () {
            Player.setQueue(tracks, 0);
            Player.play(tracks[0]);
            self.renderPlayer();
          }
        }, ['▶ Слушать весь альбом']);
        meta.appendChild(playBtn);
        hero.appendChild(meta);
        content.appendChild(hero);

        /* Track list */
        content.appendChild(self.el('div', { class: 'mt-section' }, ['Треки']));
        var list = self.el('div', {});
        tracks.forEach(function (track, i) {
          track.album = { cover_small: album.cover_small };
          var row = self.makeTrackRow(track, i, tracks);
          list.appendChild(row);
        });
        content.appendChild(list);
      }).catch(function () {
        content.innerHTML = '<div style="color:#7b7a8e;padding:16px;">Ошибка загрузки альбома</div>';
      });
    },

    /* ─── ARTIST ─── */
    renderArtist: function (id) {
      var self = this;
      this.clear();
      this.view = 'artist';

      var content = this.el('div', { style: 'flex:1;overflow-y:auto;padding:24px 28px;' });
      this.root.appendChild(this.makeHeader('Артист', true));
      this.root.appendChild(content);
      content.innerHTML = '<div style="text-align:center;padding:40px;color:#7b7a8e;">Загрузка...</div>';

      Promise.all([
        deezerGet('/artist/' + id),
        deezerGet('/artist/' + id + '/top', { limit: 10 }),
        deezerGet('/artist/' + id + '/albums', { limit: 12 })
      ]).then(function (res) {
        var artist = res[0];
        var top = res[1].data || [];
        var albums = res[2].data || [];
        content.innerHTML = '';

        /* Hero */
        var hero = self.el('div', {
          style: 'position:relative;height:200px;overflow:hidden;border-radius:12px;margin-bottom:24px;'
        });
        if (artist.picture_xl) {
          var bg = self.el('img', {
            src: artist.picture_xl,
            style: 'width:100%;height:100%;object-fit:cover;filter:brightness(.5);'
          });
          hero.appendChild(bg);
        }
        var heroText = self.el('div', {
          style: 'position:absolute;bottom:20px;left:20px;'
        });
        heroText.appendChild(self.el('div', {
          style: 'font-size:32px;font-weight:900;text-shadow:0 2px 8px rgba(0,0,0,.8);'
        }, [artist.name]));
        if (artist.nb_fan) {
          heroText.appendChild(self.el('div', {
            style: 'font-size:13px;color:#b388ff;margin-top:4px;'
          }, [artist.nb_fan.toLocaleString() + ' фанатов']));
        }
        hero.appendChild(heroText);
        content.appendChild(hero);

        /* Top tracks */
        if (top.length) {
          content.appendChild(self.el('div', { class: 'mt-section' }, ['Популярные треки']));
          var list = self.el('div', {});
          top.forEach(function (track, i) {
            var row = self.makeTrackRow(track, i, top);
            list.appendChild(row);
          });
          content.appendChild(list);
        }

        /* Albums */
        if (albums.length) {
          content.appendChild(self.el('div', { class: 'mt-section' }, ['Дискография']));
          var grid = self.el('div', {
            style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;'
          });
          albums.forEach(function (album) {
            var card = self.makeAlbumCard(album);
            grid.appendChild(card);
          });
          content.appendChild(grid);
        }
      }).catch(function () {
        content.innerHTML = '<div style="color:#7b7a8e;padding:16px;">Ошибка загрузки артиста</div>';
      });
    },

    /* ─── TORRENT INPUT ─── */
    renderTorrentInput: function () {
      var self = this;
      this.clear();
      this.view = 'torrent';

      var content = this.el('div', {
        style: 'flex:1;overflow-y:auto;padding:32px 28px;'
      });
      this.root.appendChild(this.makeHeader('Торрент-музыка', true));
      this.root.appendChild(content);

      var card = this.el('div', {
        style: 'background:#13131d;border:1px solid rgba(179,136,255,.2);border-radius:16px;padding:28px;max-width:560px;margin:0 auto;'
      });

      card.appendChild(this.el('div', {
        style: 'font-size:11px;font-weight:700;letter-spacing:1.5px;color:#b388ff;text-transform:uppercase;margin-bottom:16px;'
      }, ['🧲 Магнет-ссылка или .torrent URL']));

      var inp = this.el('input', {
        type: 'text',
        placeholder: 'magnet:?xt=urn:btih:...',
        style: 'width:100%;margin-bottom:12px;'
      });
      card.appendChild(inp);

      var searchHint = this.el('div', {
        style: 'font-size:12px;color:#7b7a8e;margin-bottom:16px;'
      }, ['После загрузки торрента мы попробуем найти метаданные по названию файлов в Deezer.']);
      card.appendChild(searchHint);

      var loadBtn = this.el('button', {
        class: 'mt-btn primary',
        style: 'width:100%;',
        onclick: function () { self.loadTorrent(inp.value.trim()); }
      }, ['Загрузить и сопоставить с Deezer']);
      card.appendChild(loadBtn);

      var statusEl = this.el('div', { style: 'margin-top:16px;font-size:13px;color:#7b7a8e;min-height:20px;' });
      card.appendChild(statusEl);

      content.appendChild(card);

      /* Info block */
      var info = this.el('div', {
        style: 'max-width:560px;margin:20px auto 0;'
      });
      info.appendChild(this.el('div', { class: 'mt-section' }, ['Как это работает']));
      [
        '🎵 Вставьте magnet-ссылку на музыкальный торрент',
        '🔍 Плагин извлечёт список файлов и найдёт метаданные в Deezer',
        '▶ Треки появятся в плеере с обложками и именами',
        '📋 Для воспроизведения потоком нужен WebTorrent в Lampa'
      ].forEach(function (t) {
        info.appendChild(self.el('div', {
          style: 'padding:8px 0;font-size:13px;color:#7b7a8e;border-bottom:1px solid rgba(255,255,255,.05);'
        }, [t]));
      });
      content.appendChild(info);
    },

    loadTorrent: function (magnet) {
      if (!magnet) return;
      var self = this;
      var statusEl = this.root.querySelector('[style*="min-height:20px"]');

      function setStatus(msg) {
        if (statusEl) statusEl.textContent = msg;
      }

      setStatus('⏳ Разбираем торрент...');

      /* Если доступен Lampa Torrent API */
      if (window.Lampa && Lampa.Torrent) {
        try {
          Lampa.Torrent.parse(magnet, function (torrent) {
            var files = (torrent.files || []).filter(function (f) {
              return /\.(mp3|flac|m4a|ogg|wav|aac)$/i.test(f.name);
            });
            if (!files.length) {
              setStatus('❌ Музыкальных файлов не найдено в торренте.');
              return;
            }
            setStatus('✅ Найдено ' + files.length + ' треков. Ищем метаданные...');
            self.matchTorrentFilesToDeezer(files, magnet);
          });
        } catch (e) {
          setStatus('❌ Ошибка: ' + e.message);
        }
      } else {
        /* Fallback: парсим magnet и имитируем */
        setStatus('⚠ Lampa Torrent API недоступен. Введите название альбома для поиска.');
        var parsed = self.parseMagnetName(magnet);
        if (parsed) {
          setStatus('🔍 Ищем "' + parsed + '" в Deezer...');
          self.searchAndPlayFromDeezer(parsed);
        } else {
          setStatus('Вставьте корректную magnet-ссылку или название альбома.');
        }
      }
    },

    parseMagnetName: function (magnet) {
      var m = magnet.match(/dn=([^&]+)/);
      if (m) return decodeURIComponent(m[1]).replace(/\+/g, ' ');
      return null;
    },

    matchTorrentFilesToDeezer: function (files, magnet) {
      var self = this;
      var tracks = [];
      var pending = files.length;

      files.forEach(function (file, i) {
        var cleanName = file.name
          .replace(/\.(mp3|flac|m4a|ogg|wav|aac)$/i, '')
          .replace(/^\d+[\.\-\s]+/, '')
          .trim();

        deezerGet('/search/track', { q: cleanName, limit: 1 }).then(function (data) {
          var deezerTrack = data.data && data.data[0];
          tracks[i] = {
            id: deezerTrack ? deezerTrack.id : i,
            title: deezerTrack ? deezerTrack.title : cleanName,
            artist: deezerTrack ? deezerTrack.artist : { name: 'Неизвестно' },
            album: deezerTrack ? deezerTrack.album : { cover_small: '', cover_medium: '' },
            duration: deezerTrack ? deezerTrack.duration : 0,
            preview: deezerTrack ? deezerTrack.preview : null,
            torrentFile: file,
            torrentMagnet: magnet,
            _fromTorrent: true
          };
          pending--;
          if (pending === 0) {
            var valid = tracks.filter(Boolean);
            Player.setQueue(valid, 0);
            Player.play(valid[0]);
            self.renderPlayer();
          }
        }).catch(function () {
          pending--;
          if (pending === 0 && tracks.filter(Boolean).length) {
            Player.setQueue(tracks.filter(Boolean), 0);
            Player.play(tracks.filter(Boolean)[0]);
            self.renderPlayer();
          }
        });
      });
    },

    searchAndPlayFromDeezer: function (query) {
      var self = this;
      deezerGet('/search/album', { q: query, limit: 1 }).then(function (data) {
        var album = data.data && data.data[0];
        if (album) self.renderAlbum(album.id);
        else {
          deezerGet('/search/track', { q: query, limit: 20 }).then(function (d) {
            var tracks = d.data || [];
            if (tracks.length) {
              Player.setQueue(tracks, 0);
              Player.play(tracks[0]);
              self.renderPlayer();
            }
          });
        }
      });
    },

    /* ─── PLAYER ─── */
    renderPlayer: function () {
      var self = this;
      this.clear();
      this.view = 'player';

      var track = Player.current();
      if (!track) return;

      var content = this.el('div', {
        style: 'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px;gap:24px;'
      });

      this.root.appendChild(this.makeHeader('Сейчас играет', true));
      this.root.appendChild(content);

      /* Cover art */
      var coverWrap = this.el('div', {
        style: 'position:relative;'
      });
      var coverUrl = (track.album && (track.album.cover_big || track.album.cover_medium || track.album.cover_small)) || '';
      if (coverUrl) {
        var coverImg = this.el('img', {
          src: coverUrl,
          style: [
            'width:240px;height:240px;border-radius:16px;object-fit:cover;',
            'box-shadow:0 20px 60px rgba(124,77,255,.4);',
            'transition:transform .3s;'
          ].join('')
        });
        coverWrap.appendChild(coverImg);
      } else {
        var placeholder = this.el('div', {
          style: [
            'width:240px;height:240px;border-radius:16px;',
            'background:linear-gradient(135deg,#7c4dff,#b388ff);',
            'display:flex;align-items:center;justify-content:center;',
            'font-size:72px;box-shadow:0 20px 60px rgba(124,77,255,.4);'
          ].join('')
        }, ['🎵']);
        coverWrap.appendChild(placeholder);
      }
      content.appendChild(coverWrap);

      /* Track info */
      var info = this.el('div', { style: 'text-align:center;max-width:320px;width:100%;' });
      var titleEl = this.el('div', {
        style: 'font-size:22px;font-weight:800;margin-bottom:6px;line-height:1.2;'
      }, [track.title]);
      var artistEl = this.el('div', {
        style: 'font-size:15px;color:#b388ff;cursor:pointer;'
      }, [track.artist ? track.artist.name : '']);
      if (track.artist && track.artist.id) {
        artistEl.onclick = function () { self.renderArtist(track.artist.id); };
      }
      info.appendChild(titleEl);
      info.appendChild(artistEl);
      if (track.album && track.album.title) {
        info.appendChild(self.el('div', {
          style: 'font-size:12px;color:#7b7a8e;margin-top:4px;'
        }, [track.album.title]));
      }
      content.appendChild(info);

      /* Progress */
      var progWrap = this.el('div', { style: 'width:100%;max-width:340px;' });
      var times = this.el('div', {
        style: 'display:flex;justify-content:space-between;font-size:11px;color:#7b7a8e;margin-bottom:6px;'
      });
      var curTime = this.el('span', {}, ['0:00']);
      var durTime = this.el('span', {}, [track.duration ? secondsToTime(track.duration) : '0:30']);
      times.appendChild(curTime);
      times.appendChild(durTime);
      progWrap.appendChild(times);

      var prog = this.el('div', { class: 'mt-prog' });
      var fill = this.el('div', { class: 'mt-prog-fill', style: 'width:0%;' });
      prog.appendChild(fill);
      prog.onclick = function (e) {
        var rect = prog.getBoundingClientRect();
        var pct = (e.clientX - rect.left) / rect.width;
        Player.seek(pct);
      };
      progWrap.appendChild(prog);
      content.appendChild(progWrap);

      /* Controls */
      var controls = this.el('div', {
        style: 'display:flex;align-items:center;gap:20px;'
      });

      var shuffleBtn = this.el('button', {
        class: 'mt-btn',
        style: 'font-size:16px;padding:10px;' + (Player.shuffle ? 'color:#b388ff;' : ''),
        onclick: function () {
          Player.shuffle = !Player.shuffle;
          shuffleBtn.style.color = Player.shuffle ? '#b388ff' : '#7b7a8e';
        }
      }, ['⇄']);

      var prevBtn = this.el('button', {
        class: 'mt-btn',
        style: 'font-size:20px;padding:10px 14px;',
        onclick: function () { Player.prev(); }
      }, ['⏮']);

      var playBtn = this.el('button', {
        class: 'mt-btn primary',
        style: 'font-size:22px;padding:12px 20px;border-radius:50%;width:56px;height:56px;',
        onclick: function () { Player.pause(); }
      }, ['▶']);

      var nextBtn = this.el('button', {
        class: 'mt-btn',
        style: 'font-size:20px;padding:10px 14px;',
        onclick: function () { Player.next(); }
      }, ['⏭']);

      var repeatBtn = this.el('button', {
        class: 'mt-btn',
        style: 'font-size:16px;padding:10px;',
        onclick: function () {
          Player.repeat = !Player.repeat;
          repeatBtn.style.color = Player.repeat ? '#b388ff' : '#7b7a8e';
        }
      }, ['↻']);

      controls.appendChild(shuffleBtn);
      controls.appendChild(prevBtn);
      controls.appendChild(playBtn);
      controls.appendChild(nextBtn);
      controls.appendChild(repeatBtn);
      content.appendChild(controls);

      /* Volume */
      var volWrap = this.el('div', {
        style: 'display:flex;align-items:center;gap:10px;width:100%;max-width:260px;'
      });
      volWrap.appendChild(self.el('span', { style: 'font-size:14px;' }, ['🔈']));
      var volSlider = self.el('input', {
        type: 'range',
        min: '0',
        max: '1',
        step: '0.01',
        style: 'flex:1;accent-color:#b388ff;'
      });
      volSlider.value = Store.get('volume', 0.8);
      volSlider.oninput = function () { Player.setVolume(parseFloat(volSlider.value)); };
      volWrap.appendChild(volSlider);
      volWrap.appendChild(self.el('span', { style: 'font-size:14px;' }, ['🔊']));
      content.appendChild(volWrap);

      /* Queue button */
      var queueBtn = this.el('button', {
        class: 'mt-btn',
        onclick: function () { self.renderQueue(); }
      }, ['📋 Очередь (' + Player.queue.length + ')']);
      content.appendChild(queueBtn);

      /* Torrent badge */
      if (track._fromTorrent) {
        content.appendChild(self.el('div', {
          style: 'font-size:11px;color:#7b7a8e;background:rgba(124,77,255,.1);padding:6px 14px;border-radius:20px;'
        }, ['🧲 Из торрента · Метаданные: Deezer']));
      }

      /* Live update */
      var updateId = setInterval(function () {
        if (!self.root || self.view !== 'player') {
          clearInterval(updateId);
          return;
        }
        var p = Player.progress();
        fill.style.width = (p * 100) + '%';
        curTime.textContent = secondsToTime(Player.currentTime());
        playBtn.textContent = Player.isPlaying() ? '⏸' : '▶';

        /* Track changed? */
        var cur = Player.current();
        if (cur && titleEl.textContent !== cur.title) {
          titleEl.textContent = cur.title;
          artistEl.textContent = cur.artist ? cur.artist.name : '';
          if (cur.album && cur.album.cover_big && coverImg) {
            coverImg.src = cur.album.cover_big;
          }
          fill.style.width = '0%';
        }
      }, 500);
    },

    /* ─── QUEUE ─── */
    renderQueue: function () {
      var self = this;
      this.clear();
      this.view = 'queue';

      var content = this.el('div', { style: 'flex:1;overflow-y:auto;padding:24px 28px;' });
      this.root.appendChild(this.makeHeader('Очередь', true));
      this.root.appendChild(content);

      var list = this.el('div', {});
      Player.queue.forEach(function (track, i) {
        var row = self.makeTrackRow(track, i, Player.queue);
        list.appendChild(row);
      });
      content.appendChild(list);
    },

    attachMiniPlayer: function (container) {
      var self = this;
      var track = Player.current();
      if (!track) return;

      var mini = this.el('div', {
        style: [
          'position:sticky;bottom:0;left:0;right:0;',
          'background:#1a1a28;border-top:1px solid rgba(179,136,255,.2);',
          'padding:12px 16px;display:flex;align-items:center;gap:12px;',
          'cursor:pointer;margin-top:24px;border-radius:12px;'
        ].join(''),
        onclick: function () { self.renderPlayer(); }
      });

      var cover = track.album && track.album.cover_small;
      if (cover) {
        mini.appendChild(this.el('img', {
          src: cover,
          style: 'width:40px;height:40px;border-radius:6px;flex-shrink:0;'
        }));
      }
      var info = this.el('div', { style: 'flex:1;min-width:0;' });
      info.appendChild(this.el('div', {
        style: 'font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
      }, [track.title]));
      info.appendChild(this.el('div', {
        style: 'font-size:11px;color:#7b7a8e;'
      }, [track.artist ? track.artist.name : '']));
      mini.appendChild(info);
      mini.appendChild(this.el('div', { style: 'font-size:24px;' }, [Player.isPlaying() ? '⏸' : '▶']));
      container.appendChild(mini);
    }
  };

  /* ──────────────────────── LAMPA РЕГИСТРАЦИЯ ─────────────────── */
  function registerPlugin() {
    if (!window.Lampa) {
      console.warn('[MusicTorrent] Lampa не найдена. Плагин работает в автономном режиме.');
      return;
    }

    Lampa.Plugin.add({
      name: PLUGIN_NAME,
      type: PLUGIN_ID,
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>',
      setup: function () {}
    });

    Lampa.Listener.follow('full', function (e) {
      if (e.type === 'complite') {
        var body = e.object.activity.render();
        var btn = document.createElement('div');
        btn.className = 'full-start__item selector';
        btn.innerHTML = '<svg width="22" viewBox="0 0 24 24" fill="currentColor" style="margin-right:6px"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg> ' + PLUGIN_NAME;
        btn.onclick = function () { UI.show(); };
        body.find('.full-start').append(btn);
      }
    });

    /* Кнопка в меню */
    Lampa.Template.add(PLUGIN_ID + '_btn', '<li class="menu__item selector"><div class="menu__ico">🎵</div><div class="menu__text">' + PLUGIN_NAME + '</div></li>');
    Lampa.Listener.follow('app', function (e) {
      if (e.type === 'ready') {
        var item = Lampa.Template.get(PLUGIN_ID + '_btn');
        item.on('hover:enter', function () { UI.show(); });
        Lampa.Menu.add(item);
      }
    });
  }

  /* ──────────────────────── СТАРТ ─────────────────────────────── */
  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        registerPlugin();
      });
    } else {
      registerPlugin();
    }
  }

  /* Dev mode: если нет Lampa, вешаем кнопку */
  if (!window.Lampa) {
    var devBtn = document.createElement('button');
    devBtn.textContent = '🎵 ' + PLUGIN_NAME + ' (dev)';
    devBtn.style.cssText = [
      'position:fixed;bottom:20px;right:20px;z-index:99998;',
      'background:#7c4dff;color:#fff;border:none;border-radius:10px;',
      'padding:12px 20px;font-size:14px;font-weight:600;cursor:pointer;',
      'box-shadow:0 4px 20px rgba(124,77,255,.5);'
    ].join('');
    devBtn.onclick = function () { UI.show(); };
    document.body.appendChild(devBtn);
  }

  init();

  /* Экспорт для внешнего использования */
  window[PLUGIN_ID] = { UI: UI, Player: Player, Deezer: deezerGet };

})();
