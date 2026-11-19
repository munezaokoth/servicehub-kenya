/* ServiceHub Kenya - profile pictures
   - Upload / change / remove your photo (Profile Settings and My Account), shrunk to 512px on the phone first
   - Photos show on My Account, Profile Settings, chat list, chat header, call screen; initials when there's no photo
   - Google sign-in photos are used automatically until you upload your own */
(function () {
  "use strict";

  const css = document.createElement("style");
  css.textContent = `
  .sh-avatar{position:relative;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;
    background:var(--gradient-primary,var(--primary));color:#fff;font-weight:800;overflow:hidden;flex-shrink:0;line-height:1}
  .sh-avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .sh-avatar-edit{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:12px}
  .sh-avatar-edit .sh-btn{font-size:.82rem}
  #profile-avatar-display{position:relative;overflow:hidden;cursor:pointer}
  #profile-avatar-display img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  #profile-avatar-display .cam{position:absolute;right:0;bottom:0;left:0;background:rgba(0,0,0,.45);color:#fff;font-size:.7rem;padding:3px 0;text-align:center}`;
  document.head.appendChild(css);

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const initials = (n) => String(n || "?").split(" ").filter(Boolean).map((x) => x[0]).join("").toUpperCase().slice(0, 2) || "?";
  const me = () => (typeof currentUser !== "undefined" ? currentUser : window.currentUser) || {};

  // Photo URL for any user (falls back to initials if they have none)
  function avatarUrl(uid, src) {
    if (src) return src;
    return uid ? `/api/users/${encodeURIComponent(uid)}/avatar` : "";
  }
  function avatarHTML(uid, name, size, src) {
    size = size || 40;
    const url = avatarUrl(uid, src);
    return `<span class="sh-avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px"><b>${esc(initials(name))}</b>${url ? `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>`;
  }
  // Put a photo into an existing round element that shows initials
  function decorate(el, uid, name, src) {
    if (!el) return;
    el.querySelectorAll("img").forEach((i) => i.remove());
    el.style.position = el.style.position || "relative";
    el.style.overflow = "hidden";
    const url = avatarUrl(uid, src);
    if (!url) return;
    const img = document.createElement("img");
    img.alt = ""; img.src = url;
    img.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit";
    img.onerror = () => img.remove();
    el.appendChild(img);
  }

  function squareJpeg(file, side = 512) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) return reject(new Error("Not an image"));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const s = Math.min(img.width, img.height);
        const c = document.createElement("canvas"); c.width = side; c.height = side;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, side, side);
        URL.revokeObjectURL(url);
        let q = 0.86, out = c.toDataURL("image/jpeg", q);
        while (out.length > 500000 && q > 0.4) { q -= 0.1; out = c.toDataURL("image/jpeg", q); }
        resolve(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image")); };
      img.src = url;
    });
  }

  let picker = null;
  function choosePhoto() {
    if (!picker) {
      picker = document.createElement("input");
      picker.type = "file"; picker.accept = "image/*"; picker.hidden = true;
      picker.onchange = async () => {
        const f = picker.files && picker.files[0]; picker.value = "";
        if (!f) return;
        let data;
        try { data = await squareJpeg(f); } catch (e) { showNotification("Please choose a photo (JPG, PNG or WebP)", "error"); return; }
        showNotification("Uploading your photo...", "info");
        const r = await shApi("/users/me/avatar", { method: "POST", body: JSON.stringify({ image: data }) }).catch(() => ({ success: false }));
        if (!r.success) { showNotification(r.message || "Could not upload your photo", "error"); return; }
        applyMyAvatar(r.avatar);
        showNotification("Profile picture updated.", "success");
      };
      document.body.appendChild(picker);
    }
    picker.click();
  }
  async function removePhoto() {
    if (!confirm("Remove your profile picture?")) return;
    const r = await shApi("/users/me/avatar", { method: "DELETE" }).catch(() => ({ success: false }));
    if (!r.success) { showNotification(r.message || "Could not remove your photo", "error"); return; }
    applyMyAvatar(null);
    showNotification("Profile picture removed.", "info");
  }
  function applyMyAvatar(url) {
    const u = me();
    u.avatar = url;
    try { window.currentUser = u; } catch (e) {}
    refreshProfileModal();
    const panelHead = document.getElementById("sh-account-avatar");
    if (panelHead) panelHead.outerHTML = accountAvatar();
  }

  function accountAvatar() {
    const u = me();
    return `<span id="sh-account-avatar" role="button" tabindex="0" title="Change profile picture" onclick="shChooseAvatar()" style="position:relative;display:inline-block;cursor:pointer">
      ${avatarHTML(u.uid, u.name, 64, u.avatar || null)}
      <span style="position:absolute;right:-2px;bottom:-2px;width:24px;height:24px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:.7rem;border:2px solid var(--white)"><i class="fas fa-camera"></i></span></span>`;
  }

  function refreshProfileModal() {
    const el = document.getElementById("profile-avatar-display");
    if (!el) return;
    const u = me();
    el.querySelectorAll("img,.cam").forEach((x) => x.remove());
    if (u.avatar) decorate(el, u.uid, u.name, u.avatar);
    const cam = document.createElement("span"); cam.className = "cam"; cam.innerHTML = '<i class="fas fa-camera"></i>';
    el.appendChild(cam);
    el.onclick = choosePhoto;
    el.title = "Change profile picture";
    let bar = document.getElementById("sh-avatar-edit");
    if (!bar) {
      bar = document.createElement("div"); bar.id = "sh-avatar-edit"; bar.className = "sh-avatar-edit";
      el.parentNode.insertBefore(bar, el.nextSibling);
    }
    bar.innerHTML = `<button type="button" class="sh-btn ghost" onclick="shChooseAvatar()"><i class="fas fa-camera"></i> ${u.avatar ? "Change photo" : "Add profile photo"}</button>
      ${u.avatar ? `<button type="button" class="sh-btn danger" onclick="shRemoveAvatar()"><i class="fas fa-trash"></i> Remove</button>` : ""}`;
  }

  // Wrap existing screens so the photo shows everywhere
  function wrap(name, after) {
    const orig = window[name];
    if (typeof orig !== "function" || orig.__shAv) return;
    const w = function () { const r = orig.apply(this, arguments); const p = r && typeof r.then === "function" ? r : Promise.resolve(r); p.then(() => { try { after.apply(this, arguments); } catch (e) {} }); return r; };
    w.__shAv = true;
    window[name] = w; // global function declarations live on window, so this replaces them everywhere
  }

  window.shConvPeer = window.shConvPeer || {};

  function hook() {
    wrap("openProfileSettings", refreshProfileModal);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hook); else hook();
  setTimeout(hook, 1500);

  window.shAvatarHTML = avatarHTML;
  window.shAccountAvatar = accountAvatar;
  window.shDecorateAvatar = decorate;
  window.shChooseAvatar = choosePhoto;
  window.shRemoveAvatar = removePhoto;
})();
