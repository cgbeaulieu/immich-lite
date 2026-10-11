/* Line icons drawn for this app (24x24, stroked in the text colour). Inline SVG works
   on the old engine and stays sharp at TV size. Icons.svg('photos') -> markup. */
var Icons = (function () {
  'use strict';

  var PATHS = {
    photos: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.6"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
    explore: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    map: '<path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
    albums: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M9 3v7.5l2.5-1.6 2.5 1.6V3"/>',
    slideshow: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M10 8.8l5.2 3.2-5.2 3.2z"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
    user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5c1.1-3.8 4-5.8 7.5-5.8s6.4 2 7.5 5.8"/>',
    logout: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M15 8l4 4-4 4M19 12H9.5"/>',
    back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    folder: '<path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.2h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.7 6.7a1.4 1.4 0 0 1-2 0z"/><circle cx="8" cy="8" r="1.6"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1.2"/><path d="M5 9v9.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4"/>',
    people: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c.8-3.4 3.3-5.2 6.5-5.2s5.7 1.8 6.5 5.2"/><path d="M15.5 5.2a3.4 3.4 0 0 1 0 6.6M17.5 15c2 .6 3.3 2.3 4 5"/>',
    place: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
    key: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M21 12v2.5"/>',
    shuffle: '<path d="M3 7h3.5c2 0 3.2 1 4.3 2.6l2.4 3.8C14.3 15 15.5 16 17.5 16H21M3 16h3.5c1.4 0 2.4-.5 3.2-1.4M14 8.4c.8-.9 1.8-1.4 3.5-1.4H21"/><path d="M18.5 4.5L21 7l-2.5 2.5M18.5 13.5L21 16l-2.5 2.5"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
    memory: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5v3.8h3.8M12 8v4.2l2.8 1.8"/>',
    star: '<path d="M12 3.8l2.5 5.2 5.6.7-4.1 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.7z"/>',
    chevron: '<path d="M9 5l7 7-7 7"/>',
    server: '<rect x="3.5" y="4" width="17" height="6.5" rx="1.5"/><rect x="3.5" y="13.5" width="17" height="6.5" rx="1.5"/><path d="M7 7.2h.01M7 16.7h.01"/>',
    photo: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 16l5-5 4 4 3-3 6 6"/>'
  };

  function svg(name, cls) {
    return '<svg class="icon' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (PATHS[name] || '') + '</svg>';
  }

  var logos = 0;

  /* The app's own mark (not Immich's logo: this is an unofficial client). Each copy
     gets its own gradient id: a copy on a hidden screen would otherwise own the
     shared one and leave the others unfilled. */
  function logo(cls) {
    var id = 'lg-logo-' + (++logos);
    return '<svg class="logo' + (cls ? ' ' + cls : '') + '" viewBox="0 0 48 48" aria-hidden="true">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#7aa7ff"/><stop offset="0.55" stop-color="#9b7bff"/><stop offset="1" stop-color="#ff7aa8"/>' +
      '</linearGradient></defs>' +
      '<rect x="2" y="2" width="44" height="44" rx="13" fill="url(#' + id + ')"/>' +
      '<path d="M11 33l9-10 6 6 4-4 7 8z" fill="#fff" opacity="0.95"/>' +
      '<circle cx="31" cy="16.5" r="3.6" fill="#fff" opacity="0.95"/></svg>';
  }

  return { svg: svg, logo: logo };
})();
