---
createdTime: <% tp.file.creation_date() %>
journalDate: <% tp.date.now() %>
journalTime: <% tp.date.now("YYYY-MM-DDTHH:mm:ss") %>
timeZone: <% Intl.DateTimeFormat().resolvedOptions().timeZone %>
coordinates:
sentiment:
isFavorite:
tags:
    - "#journal"
cssclasses:
    - journal
---

<%_ await tp.file.rename(tp.date.now("YYYY-MM-DD")) %>
<%_ await app.commands.executeCommandById("obsidian-journal:set-coordinates-from-device-gps") %>
