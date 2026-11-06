# Fonts

`TwemojiCountryFlags.woff2` comes from [country-flag-emoji-polyfill](https://github.com/talkjs/country-flag-emoji-polyfill) (MIT) by TalkJS.
The flag artwork is from [Twemoji](https://github.com/twitter/twemoji), used under the
[CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) licence. Copyright Twitter, Inc. and other contributors.

It only contains country flag glyphs and is loaded for those characters alone (see `unicode-range` in `src/app/globals.css`),
so flags show on Windows, which has no flag emoji.
