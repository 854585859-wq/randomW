/* global __DATA__ */
(function () {
  'use strict';

  var allConcerts = __DATA__.concerts;
  var allVenues = __DATA__.venues;
  var DAYS = ['日', '一', '二', '三', '四', '五', '六'];
  var VENUE_COLORS = ['#c4875c', '#8b9a8b', '#9b8a7a', '#b8946e', '#7a8a8b', '#a08b7c'];
  var now = new Date();

  // ── State ──
  var calYear = now.getFullYear();
  var calMonth = now.getMonth();
  var venueYear = now.getFullYear();
  var venueMonth = now.getMonth();
  var activeVenueId = null;
  var currentView = 'calendar';

  function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function concertOnDate(c, dateKey) {
    if (c.date === dateKey) return true;
    if (c.end_date && c.date <= dateKey && dateKey <= c.end_date) return true;
    return false;
  }

  var venueColorMap = {};
  var colorIdx = 0;
  function getVenueColor(name) {
    if (!venueColorMap[name]) {
      venueColorMap[name] = VENUE_COLORS[colorIdx % VENUE_COLORS.length];
      colorIdx++;
    }
    return venueColorMap[name];
  }

  function getVenueColorById(venueId) {
    var idx = allVenues.findIndex(function (v) { return v.id === venueId; });
    return VENUE_COLORS[idx >= 0 ? idx % VENUE_COLORS.length : 0];
  }

  function showModal(title) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal">' +
      '<button class="modal-close">&times;</button>' +
      '<h3>' + escHtml(title) + '</h3>' +
      '<div class="modal-body"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    return overlay.querySelector('.modal-body');
  }

  function showConcertDetail(id) {
    var c = allConcerts.find(function (x) { return x.id === id; });
    if (!c) return;
    var body = showModal(c.artist);
    var dateRange = c.end_date ? c.date + ' → ' + c.end_date : c.date;
    body.innerHTML =
      '<div style="line-height:2;font-weight:300;">' +
      '<p><span style="color:var(--ink-25);font-size:0.75rem;">日期</span><br>' + escHtml(dateRange) + '</p>' +
      '<p style="margin-top:0.4rem;"><span style="color:var(--ink-25);font-size:0.75rem;">场馆</span><br>' + escHtml(c.venue_name) + '</p>' +
      '<p style="margin-top:0.6rem;font-size:0.85rem;">' + escHtml(c.description || '暂无详情') + '</p>' +
      '</div>';
  }

  function bindEventClicks(container) {
    var events = container.querySelectorAll('.calendar-event');
    for (var i = 0; i < events.length; i++) {
      (function (el) {
        el.addEventListener('click', function (ev) {
          ev.stopPropagation();
          showConcertDetail(parseInt(el.getAttribute('data-id')));
        });
      })(events[i]);
    }
  }

  // ── Calendar View ──
  function renderCalendar() {
    document.getElementById('calTitle').textContent = calYear + '. ' + String(calMonth + 1).padStart(2, '0');
    var calGrid = document.getElementById('calGrid');
    var html = DAYS.map(function (d) { return '<div class="calendar-day-header">' + d + '</div>'; }).join('');
    var firstDay = new Date(calYear, calMonth, 1).getDay();
    var daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    var daysInPrevMonth = new Date(calYear, calMonth, 0).getDate();

    for (var i = firstDay - 1; i >= 0; i--) {
      var d = daysInPrevMonth - i;
      var mm = calMonth === 0 ? 12 : calMonth;
      var yy = calMonth === 0 ? calYear - 1 : calYear;
      html += '<div class="calendar-cell other-month"><div class="day-num">' + d + '</div>' + calEvents(yy, mm, d) + '</div>';
    }
    for (var d2 = 1; d2 <= daysInMonth; d2++) {
      var key = calYear + '-' + String(calMonth + 1).padStart(2, '0') + '-' + String(d2).padStart(2, '0');
      var todayKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      html += '<div class="calendar-cell' + (key === todayKey ? ' today' : '') + '"><div class="day-num">' + d2 + '</div>' + calEvents(calYear, calMonth + 1, d2) + '</div>';
    }
    var total = firstDay + daysInMonth;
    var rem = total % 7 === 0 ? 0 : 7 - (total % 7);
    for (var d3 = 1; d3 <= rem; d3++) {
      var nm = calMonth + 2 > 12 ? 1 : calMonth + 2;
      var ny = nm === 1 ? calYear + 1 : calYear;
      html += '<div class="calendar-cell other-month"><div class="day-num">' + d3 + '</div>' + calEvents(ny, nm, d3) + '</div>';
    }
    calGrid.innerHTML = html;
    bindEventClicks(calGrid);
  }

  function calEvents(y, m, d) {
    var key = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    return allConcerts.filter(function (c) { return concertOnDate(c, key); }).map(function (c) {
      var vc = getVenueColor(c.venue_name);
      return '<div class="calendar-event" style="border-left:2px solid ' + vc + ';background:' + vc + '15;" data-id="' + c.id + '">' + escHtml(c.artist) + '</div>';
    }).join('');
  }

  // ── Venues View ──
  function renderVenueButtons() {
    var container = document.getElementById('venueButtons');
    if (allVenues.length === 0) {
      container.innerHTML = '<p style="color:var(--ink-25);font-size:0.8rem;">暂无场馆</p>';
      return;
    }
    container.innerHTML = allVenues.map(function (v) {
      var c = getVenueColorById(v.id);
      var active = activeVenueId === v.id;
      return '<button class="btn btn-sm venue-btn venue-select-btn" style="' +
        (active ? 'background:' + c + ';border-color:' + c + ';color:#fff;' : 'border-color:' + c + ';color:' + c + ';') +
        '" data-venue-id="' + v.id + '">' + escHtml(v.name) + '</button>';
    }).join('');
    var btns = container.querySelectorAll('.venue-select-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        selectVenue(parseInt(this.getAttribute('data-venue-id')));
      });
    }
  }

  function selectVenue(venueId) {
    activeVenueId = venueId;
    venueYear = now.getFullYear();
    venueMonth = now.getMonth();
    renderVenueButtons();
    renderVenueCalendar();
  }

  function renderVenueCalendar() {
    var area = document.getElementById('scheduleArea');
    var venue = allVenues.find(function (v) { return v.id === activeVenueId; });
    if (!venue) {
      area.innerHTML = '<div class="empty"><div class="empty-icon">📍</div><p>请选择场馆查看档期</p></div>';
      return;
    }
    var vc = getVenueColorById(venue.id);
    var vcArr = allConcerts.filter(function (c) { return c.venue_id === venue.id; });

    var html = '<div class="calendar-header">' +
      '<h2>' + escHtml(venue.name) + ' · ' + venueYear + '.' + String(venueMonth + 1).padStart(2, '0') + '</h2>' +
      '<div>' +
      '<button class="btn btn-sm" id="vPrev">‹</button>' +
      '<button class="btn btn-sm" id="vNext">›</button>' +
      '</div></div><div class="calendar-grid">';
    html += DAYS.map(function (d) { return '<div class="calendar-day-header">' + d + '</div>'; }).join('');

    var firstDay = new Date(venueYear, venueMonth, 1).getDay();
    var daysInMonth = new Date(venueYear, venueMonth + 1, 0).getDate();
    var daysInPrevMonth = new Date(venueYear, venueMonth, 0).getDate();

    for (var i = firstDay - 1; i >= 0; i--) {
      var d = daysInPrevMonth - i;
      var mm = venueMonth === 0 ? 12 : venueMonth;
      var yy = venueMonth === 0 ? venueYear - 1 : venueYear;
      html += '<div class="calendar-cell other-month"><div class="day-num">' + d + '</div>' + venueEvts(yy, mm, d, vcArr, vc) + '</div>';
    }
    for (var d2 = 1; d2 <= daysInMonth; d2++) {
      var key = venueYear + '-' + String(venueMonth + 1).padStart(2, '0') + '-' + String(d2).padStart(2, '0');
      var todayKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      html += '<div class="calendar-cell' + (key === todayKey ? ' today' : '') + '"><div class="day-num">' + d2 + '</div>' + venueEvts(venueYear, venueMonth + 1, d2, vcArr, vc) + '</div>';
    }
    var total = firstDay + daysInMonth;
    var rem = total % 7 === 0 ? 0 : 7 - (total % 7);
    for (var d3 = 1; d3 <= rem; d3++) {
      var nm = venueMonth + 2 > 12 ? 1 : venueMonth + 2;
      var ny = nm === 1 ? venueYear + 1 : venueYear;
      html += '<div class="calendar-cell other-month"><div class="day-num">' + d3 + '</div>' + venueEvts(ny, nm, d3, vcArr, vc) + '</div>';
    }
    html += '</div>';
    area.innerHTML = html;

    document.getElementById('vPrev').addEventListener('click', function () {
      venueMonth--; if (venueMonth < 0) { venueMonth = 11; venueYear--; } renderVenueCalendar();
    });
    document.getElementById('vNext').addEventListener('click', function () {
      venueMonth++; if (venueMonth > 11) { venueMonth = 0; venueYear++; } renderVenueCalendar();
    });
    bindEventClicks(area);
  }

  function venueEvts(y, m, d, concerts, color) {
    var key = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    return concerts.filter(function (c) { return concertOnDate(c, key); }).map(function (c) {
      return '<div class="calendar-event" style="border-left:2px solid ' + color + ';background:' + color + '15;" data-id="' + c.id + '">' + escHtml(c.artist) + '</div>';
    }).join('');
  }

  // ── View Switching ──
  function switchView(view) {
    currentView = view;
    document.getElementById('mainCalendar').style.display = view === 'calendar' ? 'block' : 'none';
    document.getElementById('mainVenues').style.display = view === 'venues' ? 'block' : 'none';
    var links = document.querySelectorAll('.topbar-links a');
    links[0].classList.toggle('active', view === 'calendar');
    links[1].classList.toggle('active', view === 'venues');
    if (view === 'calendar') renderCalendar();
    else { renderVenueButtons(); document.getElementById('scheduleArea').innerHTML = '<div class="empty"><div class="empty-icon">📍</div><p>请选择场馆查看档期</p></div>'; }
  }

  // ── Actions ──
  function showFeedback() {
    var body = showModal('提供信息');
    body.innerHTML =
      '<form id="fbForm"><div class="form-group"><textarea name="message" class="form-input" rows="4" required placeholder="艺人/场馆/时间…"></textarea></div>' +
      '<button type="submit" class="btn btn-primary" style="width:100%">提交</button></form>';
    body.querySelector('#fbForm').addEventListener('submit', function (e) { e.preventDefault(); body.closest('.modal-overlay').remove(); alert('感谢提供信息！请访问 concert-kr.space 提交以实时更新。'); });
  }

  function showSubscribe() {
    var body = showModal('订阅艺人');
    body.innerHTML =
      '<p style="font-size:0.8rem;color:var(--ink-50);margin-bottom:0.8rem;">填写你想关注的艺人，有新演出时邮件通知</p>' +
      '<form id="subForm"><div class="form-group"><label>邮箱 *</label><input type="email" name="email" class="form-input" required></div>' +
      '<div class="form-group"><label>艺人 *</label><input type="text" name="artist" class="form-input" required placeholder="输入想关注的艺人名"></div>' +
      '<button type="submit" class="btn btn-primary" style="width:100%">订阅</button></form>';
    body.querySelector('#subForm').addEventListener('submit', function (e) { e.preventDefault(); body.closest('.modal-overlay').remove(); alert('请访问 concert-kr.space 完成订阅，实时接收邮件通知。'); });
  }

  function showShare() {
    var body = showModal('分享');
    body.innerHTML =
      '<div style="text-align:center;line-height:2;"><p style="font-size:0.85rem;">韩国演唱会日历 · 查档期超方便 👀</p>' +
      '<p style="margin-top:0.8rem;padding:0.6rem;background:var(--bg);border-radius:4px;font-size:0.9rem;user-select:all;">concert-kr.space</p>' +
      '<p style="font-size:0.65rem;color:var(--ink-25);margin-top:0.4rem;">长按选中网址即可复制</p></div>';
  }

  function init() {
    document.getElementById('btnPrev').addEventListener('click', function () { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); });
    document.getElementById('btnNext').addEventListener('click', function () { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); });
    var navLinks = document.querySelectorAll('.topbar-links a');
    navLinks[0].addEventListener('click', function (e) { e.preventDefault(); switchView('calendar'); });
    navLinks[1].addEventListener('click', function (e) { e.preventDefault(); switchView('venues'); });
    document.getElementById('btnFeedback').addEventListener('click', showFeedback);
    document.getElementById('btnSubscribe').addEventListener('click', showSubscribe);
    document.getElementById('btnShare').addEventListener('click', showShare);
    switchView('calendar');
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
  else { init(); }
})();
