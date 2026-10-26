/**
 * The dashboard's only script, served at /dashboard/assets/app.js (CSP allows same-origin scripts only).
 * Every table with data-table gets: click-to-sort headers, a "Columns" menu to show/hide columns, and
 * "View" buttons that open a row's <template> in a modal. Preferences are kept in localStorage when available.
 */
export const DASHBOARD_SCRIPT = String.raw`(function () {
  "use strict";
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  function sortKey(cell, type) {
    var v = cell.hasAttribute("data-sort") ? cell.getAttribute("data-sort") : cell.textContent.trim();
    if (type === "num") { var n = parseFloat(v); return isNaN(n) ? -Infinity : n; }
    return v.toLowerCase();
  }

  function setup(table) {
    var name = table.getAttribute("data-table");
    var heads = Array.prototype.slice.call(table.tHead.rows[0].cells);
    var body = table.tBodies[0];
    var rows = function () { return Array.prototype.filter.call(body.rows, function (r) { return !r.hasAttribute("data-empty"); }); };

    function sortBy(i, dir) {
      heads.forEach(function (h) { if (h !== heads[i]) h.removeAttribute("aria-sort"); });
      heads[i].setAttribute("aria-sort", dir);
      var type = heads[i].getAttribute("data-type") || "text";
      var sorted = rows().sort(function (a, b) {
        var x = sortKey(a.cells[i], type), y = sortKey(b.cells[i], type);
        return (x < y ? -1 : x > y ? 1 : 0) * (dir === "ascending" ? 1 : -1);
      });
      sorted.forEach(function (r) { body.appendChild(r); });
      store.set("sort:" + name, { col: heads[i].getAttribute("data-col"), dir: dir });
    }

    heads.forEach(function (th, i) {
      if (th.hasAttribute("data-nosort")) return;
      th.classList.add("sortable");
      th.tabIndex = 0;
      var toggle = function () { sortBy(i, th.getAttribute("aria-sort") === "ascending" ? "descending" : "ascending"); };
      th.addEventListener("click", toggle);
      th.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    });

    var defaults = (table.getAttribute("data-hidden") || "").split(",").filter(Boolean);
    var hidden = store.get("cols:" + name) || defaults;
    function apply() {
      heads.forEach(function (th, i) {
        var off = hidden.indexOf(th.getAttribute("data-col")) !== -1;
        th.hidden = off;
        Array.prototype.forEach.call(body.rows, function (r) { if (r.cells[i] && !r.hasAttribute("data-empty")) r.cells[i].hidden = off; });
      });
    }

    var slot = document.querySelector('[data-columns-for="' + name + '"]');
    if (slot) {
      var menu = document.createElement("details");
      menu.className = "columns";
      menu.innerHTML = '<summary>Columns</summary><div class="menu"></div>';
      var list = menu.querySelector(".menu");
      heads.forEach(function (th) {
        if (th.hasAttribute("data-fixed")) return;
        var col = th.getAttribute("data-col");
        var label = document.createElement("label");
        var box = document.createElement("input");
        box.type = "checkbox";
        box.checked = hidden.indexOf(col) === -1;
        box.addEventListener("change", function () {
          hidden = box.checked ? hidden.filter(function (c) { return c !== col; }) : hidden.concat([col]);
          store.set("cols:" + name, hidden);
          apply();
        });
        label.appendChild(box);
        label.appendChild(document.createTextNode(" " + th.textContent.trim()));
        list.appendChild(label);
      });
      var reset = document.createElement("button");
      reset.type = "button";
      reset.className = "link";
      reset.textContent = "Show all";
      reset.addEventListener("click", function () {
        hidden = [];
        store.set("cols:" + name, hidden);
        list.querySelectorAll("input").forEach(function (b) { b.checked = true; });
        apply();
      });
      list.appendChild(reset);
      slot.appendChild(menu);
      document.addEventListener("click", function (e) { if (!menu.contains(e.target)) menu.open = false; });
    }

    apply();
    var saved = store.get("sort:" + name);
    if (saved) {
      var idx = heads.findIndex(function (h) { return h.getAttribute("data-col") === saved.col; });
      if (idx !== -1) sortBy(idx, saved.dir);
    }
  }

  document.querySelectorAll("table[data-table]").forEach(setup);

  var dialog = document.getElementById("detail-dialog");
  if (!dialog) return;
  document.addEventListener("click", function (e) {
    var button = e.target.closest && e.target.closest("[data-detail]");
    if (button) {
      var tpl = document.getElementById(button.getAttribute("data-detail"));
      if (!tpl) return;
      dialog.querySelector(".dialog-title").textContent = button.getAttribute("data-title") || "Details";
      var content = dialog.querySelector(".dialog-body");
      content.innerHTML = "";
      content.appendChild(tpl.content.cloneNode(true));
      dialog.showModal();
      return;
    }
    if (e.target === dialog || (e.target.closest && e.target.closest(".dialog-close"))) dialog.close();
  });
})();
`;
