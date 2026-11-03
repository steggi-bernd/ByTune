#!/bin/bash
# Runs after the .deb is removed (and during an upgrade, before the new
# version's after-install). electron-builder's own step, then the AppArmor
# profile after-install.tpl added, but only when Songsta really goes.

# Delete the link to the binary
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/usr/bin/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

if [ "$1" = remove ] || [ "$1" = purge ]; then
    if [ -f '/etc/apparmor.d/${executable}' ]; then
        if hash apparmor_parser 2>/dev/null; then
            apparmor_parser --remove '/etc/apparmor.d/${executable}' >/dev/null 2>&1 || true
        fi
        rm -f '/etc/apparmor.d/${executable}'
    fi
fi
