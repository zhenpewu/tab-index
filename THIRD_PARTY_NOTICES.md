# Third-Party Notices

Tab Index contains third-party libraries and behavior adapted from or informed
by the projects listed below.

## Duplicate Tabs Closer 4.3.4

- Project: Duplicate Tabs Closer
- Author: Peuj
- Source: https://github.com/Peuj/duplicate-tabs-closer
- Inspected commit: `33b072e398cb012b63d72026c46b27c26c6e3050`
- License: GNU General Public License version 3 or later
- Use in Tab Index: duplicate matching and retained-tab behavior were adapted
  into Tab Index's typed domain modules.
- Modified for Tab Index on 2026-10-08. The adapted implementation lives in
  `src/domain/duplicates.ts`, `src/domain/rules.ts`, `src/domain/title.ts`, and
  `src/domain/url.ts`.

Upstream copyright and license notice:

```text
Duplicate Tabs Closer - detects and closes duplicate browser tabs.
Copyright (C) 2018  Peuj
```

The upstream project permits redistribution under GNU GPL version 3 or, at the
recipient's option, any later version. Tab Index distributes the adapted
portions under GNU GPL version 3. The complete GNU GPL version 3 license text
is included in `LICENSE`.

## Tab Search

- Project: Tab Search
- Author: reblws
- Source: https://github.com/reblws/tab-search
- Inspected commit: `3871b516ab96b0c6685392c908f7774f2248f757`
- License: MIT
- Use in Tab Index: tab-search interaction and ranking behavior informed the
  Tab Index search design.

MIT License

Copyright (c) 2017 reblws <reblws@protonmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Preact 11.0.0

- Package: `preact` 11.0.0
- Authors: The Preact Authors
- Source: https://github.com/preactjs/preact
- License: MIT
- Use in Tab Index: popup and settings user interface runtime.

The MIT License (MIT)

Copyright (c) 2015-present Jason Miller

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Fuse.js 7.5.0

- Package: `fuse.js` 7.5.0
- Author: Kiro Risk
- Source: https://github.com/krisk/Fuse
- License: Apache License 2.0
- Use in Tab Index: fuzzy title and URL search.

Copyright 2017 Kirollos Risk

The complete Apache License 2.0 text and Fuse.js application notice are
included in `licenses/fuse.js-Apache-2.0.txt`. The distributed Fuse.js package
does not contain a separate `NOTICE` file.

## Corresponding source

Each packaged Tab Index extension ZIP is accompanied by a version-matched
`tab_index-<version>-source.tar.gz` archive containing the tracked source,
build configuration, tests, license, and notices needed to rebuild that
version.
