#!/bin/bash
# Runs after the .deb is installed. electron-builder's own steps (the
# /usr/bin link, Chromium's sandbox helper, the desktop and MIME databases),
# then an AppArmor profile for Ubuntu 23.10 and later: there AppArmor only
# lets programs it knows open the user namespaces Chromium's sandbox runs
# in, and without one Songsta would stop at start ("The SUID sandbox helper
# binary was found, but is not configured correctly").
#
# electron-builder fills in the dollar-brace names when it builds the package
# and knows no others, so shell variables here go without braces.

if type update-alternatives 2>/dev/null >&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Check if user namespaces are supported by the kernel and working with a quick test:
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# The profile confines nothing; it only allows the user namespaces. It needs
# AppArmor 4 (abi/4.0, Ubuntu 24.04 and later); older versions can't read it
# and don't restrict namespaces, so a dry run decides.
if hash apparmor_parser 2>/dev/null && [ -d /etc/apparmor.d ]; then
    profile=$(mktemp)
    cat > "$profile" <<'EOF'
# Songsta: allows everything; exists so Chromium's sandbox may use user namespaces.
abi <abi/4.0>,
include <tunables/global>

profile ${executable} "/opt/${sanitizedProductName}/${executable}" flags=(unconfined) {
  userns,

  # Site-specific additions and overrides. See local/README for details.
  include if exists <local/${executable}>
}
EOF
    if apparmor_parser --skip-kernel-load --debug "$profile" >/dev/null 2>&1; then
        install -m 644 "$profile" '/etc/apparmor.d/${executable}'
        # Load it now, so the first start works without a reboot (not inside a chroot).
        if ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; }; then
            apparmor_parser --replace --write-cache --skip-read-cache '/etc/apparmor.d/${executable}' || true
        fi
    fi
    rm -f "$profile"
fi
