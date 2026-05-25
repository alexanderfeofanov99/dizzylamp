(function () {
    'use strict';

    // Функция инициализации плагина
    function startPlugin() {
        if (window.deezerPluginLoaded) return;
        window.deezerPluginLoaded = true;

        console.log('Deezer Torrent Music Plugin: Инициализирован');

        // 1. Добавляем пункт в главное левое меню Lampa
        Lampa.Listener.follow('app', function (e) {
            if (e.type == 'ready') {
                var menu_item = {
                    title: 'Deezer Музыка',
                    id: 'deezer_music',
                    icon: '<svg ...></svg>' // SVG иконка для меню
                };

                // Встраиваем пункт в меню
                Lampa.Menu.add(menu_item);
            }
        });

        // 2. Слушаем клик по нашему пункту меню
        Lampa.Listener.follow('menu', function (e) {
            if (e.type == 'click' && e.item.id == 'deezer_music') {
                openMusicCatalog();
            }
        });
    }

    // Открытие интерфейса плагина
    function openMusicCatalog() {
        // Создаем пустой экран Lampa Activity
        var activity = {
            component: 'deezer_music_catalog',
            title: 'Deezer Каталог',
            page: 1
        };

        // Рендерим базовый контейнер (компонент)
        var component = new Lampa.Component(activity);
        
        component.create = function () {
            var view = $('<div class="deezer-catalog"></div>');
            
            // Здесь вызывается функция поиска/получения данных из API Deezer
            fetchMusicMetadata('search', 'Linkin Park', function(data) {
                // Отрисовываем полученные альбомы/треки на экране
                data.data.forEach(function(item) {
                    var card = $('<div class="music-card selector"><h4>' + item.title + '</h4><p>' + item.artist.name + '</p></div>');
                    
                    // Обработчик нажатия на карточку трека
                    card.on('hover:enter', function() {
                        startTorrentSearch(item.artist.name + ' ' + item.title);
                    });
                    
                    view.append(card);
                });
                
                // Передаем управление фокусу Lampa (навигация пультом)
                Lampa.Controller.add('content', {
                    toggle: function () {
                        Lampa.Controller.collectionSet(view);
                        Lampa.Controller.collectionFocus(false, view);
                    }
                });
            });

            return view;
        };

        Lampa.Activity.push(component);
    }

    // 3. Запрос метаданных к Deezer API
    function fetchMusicMetadata(type, query, callback) {
        var url = 'https://deezer.com' + type + '?q=' + encodeURIComponent(query);
        
        $.ajax({
            url: url,
            method: 'GET',
            dataType: 'json',
            success: callback,
            error: function (err) {
                Lampa.Noty.show('Ошибка загрузки метаданных Deezer');
            }
        });
    }

    // 4. Поиск торрента по текстовому названию и запуск
    function startTorrentSearch(searchQuery) {
        Lampa.Noty.show('Ищем раздачу: ' + searchQuery);
        
        // Используем встроенный механизм Lampa для поиска через Jackett / Torlook
        // Обычно Lampa работает через провайдеры парсеров.
        var parserUrl = Lampa.Storage.get('parser_use') ? Lampa.Storage.get('parser_jackett_link') : '';
        
        if (!parserUrl) {
            Lampa.Noty.show('Настройте Jackett/Торрент парсер в Lampa!');
            return;
        }

        // Пример формирования запроса к Jackett
        var jackettApi = parserUrl + '/api/v1.0/indexers/all/results?apikey=' + Lampa.Storage.get('parser_jackett_key') + '&Query=' + encodeURIComponent(searchQuery);

        $.ajax({
            url: jackettApi,
            method: 'GET',
            success: function(res) {
                if (res.Results && res.Results.length > 0) {
                    // Берем первый попавшийся торрент (для простоты примера)
                    var torrentLink = res.Results[0].MagnetUri || res.Results[0].Link;
                    playViaTorrServer(torrentLink);
                } else {
                    Lampa.Noty.show('Музыкальный торрент не найден');
                }
            }
        });
    }

    // 5. Передача торрента в TorrServer и запуск аудиоплеера Lampa
    function playViaTorrServer(torrentUrl) {
        var torrServerUrl = Lampa.Storage.get('torrserver_url') || 'http://127.0.0.1:8090';
        
        // Добавляем торрент в TorrServer для получения прямой HTTP-ссылки на стрим
        $.ajax({
            url: torrServerUrl + '/torrent/add',
            method: 'POST',
            data: JSON.stringify({ link: torrentUrl, save: false }),
            contentType: 'application/json',
            success: function(data) {
                if (data.hash) {
                    // Получаем список файлов внутри торрента, чтобы выбрать первый аудиофайл
                    $.get(torrServerUrl + '/torrent/play?hash=' + data.hash, function(playData) {
                        // Ищем первый аудиофайл (.mp3, .flac)
                        var audioFile = data.files.find(f => f.path.match(/\.(mp3|flac|m4a)$/i));
                        var fileId = audioFile ? audioFile.id : 0;

                        // Ссылка на прямой стрим аудиопотока из торрента
                        var streamUrl = torrServerUrl + '/stream?hash=' + data.hash + '&id=' + fileId;

                        // Передаем ссылку во встроенный плеер Lampa
                        var videoObject = {
                            url: streamUrl,
                            title: 'Deezer Stream',
                            method: 'play'
                        };
                        
                        Lampa.Player.play(videoObject);
                        Lampa.Player.playlist([videoObject]);
                    });
                }
            }
        });
    }

    // Запуск при загрузке скрипта системой плагинов
    if (window.Lampa) {
        startPlugin();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type == 'ready') startPlugin();
        });
    }
})();
