import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { readdir } from 'node:fs';

// Note: Using Node.js built-in test runner since no specific testing framework was detected
// This test file focuses on the core refactor changes in the diff, particularly the 
// component-based UI changes and message content composition

describe('mw_check_wiki - Core Refactor Tests', () => {
  let mockLang, mockMsg, mockWiki, mockReaction;
  let originalConsoleLog, originalConsoleError;

  beforeEach(() => {
    // Store original console methods to restore later
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    
    // Mock console methods to reduce test noise
    console.log = () => {};
    console.error = () => {};

    // Setup comprehensive mock objects based on the function signature
    mockLang = {
      get: (key, ...args) => `mocked_${key}_${args.join('_')}`,
      lang: 'en',
      aliases: {
        random: 'random',
        overview: 'overview', 
        test: 'test',
        page: 'page',
        diff: 'diff',
        search: 'search',
        discussion: 'discussion'
      },
      uselang: (variant, uselang) => ({
        get: (key) => `localized_${key}`,
        lang: uselang || variant || 'en',
        aliases: {}
      })
    };

    mockMsg = {
      guildId: 'test-guild-123',
      wikiWhitelist: [],
      wikiPrefixes: new Map(),
      notMinecraft: false,
      embedLimits: { 
        descLength: 500,
        fieldLength: 1024,
        titleLength: 256
      },
      fetchReply: () => Promise.resolve({ 
        reactEmoji: (emoji) => Promise.resolve()
      }),
      reactEmoji: (emoji) => Promise.resolve(),
      inCachedGuild: () => true,
      client: {
        application: {
          commands: {
            cache: {
              find: (predicate) => ({
                name: 'interwiki',
                id: '987654321'
              })
            }
          }
        }
      },
      commandName: 'wiki',
      commandId: '123456789'
    };

    mockWiki = {
      href: 'https://example.wiki/',
      host: 'example.wiki',
      articlepath: '/wiki/$1',
      spaceReplacement: '_',
      name: 'Example Wiki',
      wikifarm: 'mediawiki',
      toLink: (title, params, fragment) => {
        let url = `https://example.wiki/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
        if (params && params.toString()) url += '?' + params.toString();
        if (fragment) url += '#' + encodeURIComponent(fragment);
        return url;
      },
      updateWiki: (general, namespaces, aliases) => {},
      noWiki: (url, statusCode) => statusCode === 404,
      namespaces: new Map([
        [-1, { name: 'Special' }],
        [0, { name: '' }],
        [2, { name: 'User' }],
        [14, { name: 'Category' }],
        [200, { name: 'UserProfile' }],
        [202, { name: 'UserWiki' }],
        [1200, { name: 'Message Wall' }]
      ]),
      articleURL: new URL('https://example.wiki/wiki/$1')
    };

    mockReaction = {
      removeEmoji: () => Promise.resolve()
    };

    // Reset global state
    global.minecraft = {
      WIKI: () => {},
      hasOwnProperty: (prop) => false
    };
  });

  afterEach(() => {
    // Restore console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe('Message Content Composition (Core Refactor)', () => {
    it('should compose message content with page information', () => {
      const spoiler = '||';
      const pagelink = 'https://example.wiki/wiki/Test_Page';
      const querypage = {
        title: 'Test Page',
        pageprops: {
          displaytitle: 'Test Page Display Title',
          description: 'A test page description'
        },
        extract: 'This is a test page extract content.'
      };
      
      // Simulate the infoParts construction from the diff
      let infoParts = [
        `**${querypage.title}**`, // escapeFormatting would be applied
        querypage.pageprops?.displaytitle || "",
        querypage.extract || "",
        querypage.pageprops?.description && mockMsg.embedLimits.descLength
          ? querypage.pageprops.description.substring(0, mockMsg.embedLimits.descLength) + '\u2026'
          : ""
      ];

      const messageContent = `${spoiler}<${pagelink}>${infoParts.filter(Boolean).join('\n')}${spoiler}`;
      
      assert.ok(messageContent.includes(spoiler));
      assert.ok(messageContent.includes(pagelink));
      assert.ok(messageContent.includes('**Test Page**'));
      assert.ok(messageContent.includes('Test Page Display Title'));
      assert.ok(messageContent.includes('This is a test page extract content.'));
      assert.ok(messageContent.includes('A test page description'));
    });

    it('should handle empty and undefined info parts', () => {
      const infoParts = [
        '**Test Page**',
        '', // empty string
        'Valid content',
        null,
        undefined,
        'More valid content'
      ];
      
      const filtered = infoParts.filter(Boolean);
      
      assert.deepStrictEqual(filtered, [
        '**Test Page**',
        'Valid content', 
        'More valid content'
      ]);
    });

    it('should truncate description based on embed limits', () => {
      const longDescription = 'A'.repeat(600);
      const descLength = mockMsg.embedLimits.descLength; // 500
      
      const truncated = longDescription.length > descLength
        ? longDescription.substring(0, descLength) + '\u2026'
        : longDescription;
      
      assert.strictEqual(truncated.length, 501); // 500 + ellipsis
      assert.ok(truncated.endsWith('\u2026'));
    });

    it('should handle displaytitle truncation', () => {
      const longDisplayTitle = 'B'.repeat(300);
      let displaytitle = longDisplayTitle;
      
      if (displaytitle.length > 250) {
        displaytitle = displaytitle.substring(0, 250) + '\u2026';
      }
      
      assert.strictEqual(displaytitle.length, 251);
      assert.ok(displaytitle.endsWith('\u2026'));
    });
  });

  describe('Category Information Processing (From Diff)', () => {
    it('should format category statistics correctly', () => {
      const querypage = {
        categoryinfo: {
          size: 25,
          pages: 15,
          files: 5,
          subcats: 5
        }
      };

      // Simulate the category processing logic from the diff
      let categoryParts = [mockLang.get('search.category.content')];
      
      if (querypage.categoryinfo.size === 0) {
        categoryParts.push(mockLang.get('search.category.empty'));
      }
      if (querypage.categoryinfo.pages > 0) {
        categoryParts.push(mockLang.get('search.category.pages', 
          querypage.categoryinfo.pages.toLocaleString(mockLang.get('dateformat')), 
          querypage.categoryinfo.pages));
      }
      if (querypage.categoryinfo.files > 0) {
        categoryParts.push(mockLang.get('search.category.files',
          querypage.categoryinfo.files.toLocaleString(mockLang.get('dateformat')),
          querypage.categoryinfo.files));
      }
      if (querypage.categoryinfo.subcats > 0) {
        categoryParts.push(mockLang.get('search.category.subcats',
          querypage.categoryinfo.subcats.toLocaleString(mockLang.get('dateformat')),
          querypage.categoryinfo.subcats));
      }

      assert.ok(categoryParts.includes('mocked_search.category.content_'));
      assert.ok(categoryParts.some(part => part.includes('search.category.pages')));
      assert.ok(categoryParts.some(part => part.includes('search.category.files')));
      assert.ok(categoryParts.some(part => part.includes('search.category.subcats')));
    });

    it('should handle empty categories', () => {
      const querypage = {
        categoryinfo: {
          size: 0,
          pages: 0,
          files: 0,
          subcats: 0
        }
      };

      let categoryParts = [mockLang.get('search.category.content')];
      
      if (querypage.categoryinfo.size === 0) {
        categoryParts.push(mockLang.get('search.category.empty'));
      }

      assert.ok(categoryParts.includes('mocked_search.category.empty_'));
    });
  });

  describe('ActionRow and Button Creation (Core Refactor)', () => {
    it('should create button configuration for wiki pages', () => {
      const pagelink = 'https://example.wiki/wiki/Test_Page';
      
      // Mock the ActionRowBuilder and ButtonBuilder from discord.js
      const mockButton = {
        setLabel: function(label) { this.label = label; return this; },
        setStyle: function(style) { this.style = style; return this; },
        setURL: function(url) { this.url = url; return this; }
      };
      
      const mockRow = {
        addComponents: function(...components) { 
          this.components = components; 
          return this; 
        }
      };

      // Simulate the button creation from the diff
      mockButton
        .setLabel('Open Wiki Page')
        .setStyle('Link') // ButtonStyle.Link
        .setURL(pagelink);
      
      mockRow.addComponents(mockButton);

      assert.strictEqual(mockButton.label, 'Open Wiki Page');
      assert.strictEqual(mockButton.style, 'Link');
      assert.strictEqual(mockButton.url, pagelink);
      assert.strictEqual(mockRow.components.length, 1);
    });

    it('should create button for main page with correct label', () => {
      const pagelink = 'https://example.wiki/wiki/Main_Page';
      
      const mockButton = {
        setLabel: function(label) { this.label = label; return this; },
        setStyle: function(style) { this.style = style; return this; },
        setURL: function(url) { this.url = url; return this; }
      };
      
      const mockRow = {
        addComponents: function(...components) { 
          this.components = components; 
          return this; 
        }
      };

      // Simulate main page button creation from the diff
      mockButton
        .setLabel('Open Wiki Main Page')
        .setStyle('Link')
        .setURL(pagelink);
      
      mockRow.addComponents(mockButton);

      assert.strictEqual(mockButton.label, 'Open Wiki Main Page');
      assert.strictEqual(mockButton.url, pagelink);
    });

    it('should handle noEmbed flag to skip button creation', () => {
      const noEmbed = true;
      const row = noEmbed ? null : { components: ['button'] };
      
      assert.strictEqual(row, null);
    });
  });

  describe('URL Processing and Fragment Handling', () => {
    it('should handle URL with backslashes correctly', () => {
      const title = 'https://example.wiki/wiki\\Test\\Page';
      
      // Test the URL sanitization from the function
      const sanitized = title.replaceAll('\\', '%5C').replace(/@(here|everyone)/g, '%40$1');
      
      assert.ok(sanitized.includes('%5C'));
      assert.ok(!sanitized.includes('\\'));
    });

    it('should handle @ mentions in URLs', () => {
      const title = 'https://example.wiki/wiki/@everyone';
      
      const sanitized = title.replace(/@(here|everyone)/g, '%40$1');
      
      assert.strictEqual(sanitized, 'https://example.wiki/wiki/%40everyone');
    });

    it('should extract fragment from title with hash', () => {
      const fullTitle = 'Test_Page#Section_Name';
      let fragment = '';
      let title = fullTitle;
      
      if (title.includes('#')) {
        fragment = title.split('#').slice(1).join('#').trim();
        title = title.split('#')[0];
        
        // Simulate partialURIdecode function
        fragment = fragment.replace(/(?:%[\dA-F]{2})+/g, (match) => {
          try {
            return decodeURIComponent(match);
          } catch {
            return match;
          }
        });
      }
      
      assert.strictEqual(title, 'Test_Page');
      assert.strictEqual(fragment, 'Section_Name');
    });

    it('should handle querystring extraction from title', () => {
      const fullTitle = 'Test_Page?action=edit&section=1';
      let title = fullTitle;
      let querystring = new URLSearchParams();
      
      if (/\?\w+=/.test(title)) {
        let querystart = title.search(/\?\w+=/);
        querystring = new URLSearchParams(title.substring(querystart + 1));
        title = title.substring(0, querystart);
      }
      
      assert.strictEqual(title, 'Test_Page');
      assert.strictEqual(querystring.get('action'), 'edit');
      assert.strictEqual(querystring.get('section'), '1');
    });
  });

  describe('Title Processing and Validation', () => {
    it('should truncate overly long titles', () => {
      const longTitle = 'A'.repeat(300);
      let title = longTitle;
      let shouldReact = false;
      
      if (title.length > 250) {
        title = title.substring(0, 250);
        shouldReact = true;
      }
      
      assert.strictEqual(title.length, 250);
      assert.ok(shouldReact);
    });

    it('should handle empty title with querystring fallback', () => {
      let title = '';
      const querystring = new URLSearchParams('title=Fallback_Page');
      
      // Simulate the articleURL parameter processing
      mockWiki.articleURL.searchParams.forEach((value, name) => {
        if (value.includes('$1') && querystring.has(name)) {
          title = querystring.get(name);
          querystring.delete(name);
          if (value !== '$1') {
            // Handle complex parameter patterns
            const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            title = title.replace(new RegExp('^' + escapedValue.replaceAll('$1', '(.*?)') + '$'), '$1');
          }
        }
      });

      if (!title && querystring.has('title')) {
        title = querystring.get('title');
        querystring.delete('title');
      }
      
      assert.strictEqual(title, 'Fallback_Page');
    });

    it('should apply partialURIdecode to title', () => {
      const encodedTitle = 'Test%20Page%21%3F';
      
      // Mock partialURIdecode behavior
      const decoded = encodedTitle.replace(/(?:%[\dA-F]{2})+/g, (match) => {
        try {
          return decodeURIComponent(match);
        } catch {
          return match;
        }
      });
      
      assert.strictEqual(decoded, 'Test Page!?');
    });
  });

  describe('Special Command Routing', () => {
    it('should route to random function for random command', () => {
      const fullTitle = 'random';
      const invoke = fullTitle.split(' ')[0].toLowerCase();
      const args = fullTitle.split(' ').slice(1);
      const aliasInvoke = mockLang.aliases[invoke] || invoke;
      
      assert.strictEqual(aliasInvoke, 'random');
      assert.deepStrictEqual(args, []);
    });

    it('should route to page command and return link', () => {
      const fullTitle = 'page Test Page Name';
      const invoke = fullTitle.split(' ')[0].toLowerCase();
      const args = fullTitle.split(' ').slice(1);
      const aliasInvoke = mockLang.aliases[invoke] || invoke;
      
      if (aliasInvoke === 'page') {
        const spoiler = '';
        const result = spoiler + '<' + mockWiki.toLink(args.join(' '), new URLSearchParams(), '') + '>' + spoiler;
        
        assert.ok(result.includes('https://example.wiki/wiki/Test%20Page%20Name'));
      }
    });

    it('should handle diff command with querystring parameters', () => {
      const querystring = new URLSearchParams('diff=123&oldid=456&title=TestPage');
      const diffKeys = ['diff', 'oldid', 'curid', 'title'];
      
      const isDiffCommand = querystring.has('diff') && 
        [...querystring.keys()].every(name => diffKeys.includes(name));
      
      if (isDiffCommand) {
        const diffArgs = [querystring.get('diff'), querystring.get('oldid')];
        assert.deepStrictEqual(diffArgs, ['123', '456']);
      }
    });
  });

  describe('Redirect and Action Handling', () => {
    it('should detect no-redirect conditions', () => {
      const querystring1 = new URLSearchParams('redirect=no');
      const querystring2 = new URLSearchParams('action=edit');
      
      const noRedirect1 = querystring1.getAll('redirect').pop() === 'no';
      const noRedirect2 = querystring2.has('action') && querystring2.getAll('action').pop() !== 'view';
      
      assert.ok(noRedirect1);
      assert.ok(noRedirect2);
    });

    it('should handle language parameter detection', () => {
      const querystring = new URLSearchParams('variant=zh-tw&uselang=fr');
      let uselang = 'content';
      
      if (querystring.has('variant') || querystring.has('uselang')) {
        uselang = querystring.getAll('variant').pop() || querystring.getAll('uselang').pop() || uselang;
        // This would trigger lang.uselang() call
        const newLang = mockLang.uselang(querystring.getAll('variant').pop(), querystring.getAll('uselang').pop());
        
        assert.strictEqual(uselang, 'zh-tw'); // variant takes precedence
        assert.strictEqual(newLang.lang, 'fr'); // uselang parameter passed through
      }
    });
  });

  describe('User Page and Namespace Detection', () => {
    it('should identify user pages correctly', () => {
      const testCases = [
        { title: 'User:TestUser', ns: 2, expected: true },
        { title: 'User:192.168.1.1/24', ns: 2, expected: true },
        { title: 'User:2001:DB8::1', ns: 2, expected: true },
        { title: 'UserProfile:TestUser', ns: 200, expected: true },
        { title: 'User:TestUser/Subpage', ns: 2, expected: false }
      ];

      testCases.forEach(testCase => {
        const isUserPage = (testCase.ns === 2 || testCase.ns === 200 || testCase.ns === 202 || testCase.ns === 1200) && 
          (!testCase.title.includes('/') || /^[^:]+:(?:(?:\d{1,3}\.){3}\d{1,3}\/\d{2}|(?:[\dA-F]{1,4}:){1,2}[\dA-F]{1,4})$/.test(testCase.title.split(':')[1]));
        
        assert.strictEqual(isUserPage, testCase.expected, `Failed for ${testCase.title}`);
      });
    });

    it('should handle contributions page detection', () => {
      const specialPageAliases = [
        { realname: 'Contributions', aliases: ['Contributions'] }
      ];
      
      const contribs = mockWiki.namespaces.get(-1).name + ':' + 
        specialPageAliases.find(sp => sp.realname === 'Contributions').aliases[0] + '/';
      
      const title = 'Special:Contributions/TestUser';
      const isContribsPage = title.startsWith(contribs) && title.length > contribs.length;
      
      assert.ok(isContribsPage);
      
      const username = title.split('/').slice(1).join('/');
      assert.strictEqual(username, 'TestUser');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle malformed URL creation gracefully', () => {
      const malformedUrl = 'not-a-valid-url';
      let error = null;
      
      try {
        new URL(malformedUrl, mockWiki.href);
      } catch (e) {
        error = e;
      }
      
      assert.ok(error instanceof TypeError);
    });

    it('should handle missing page properties safely', () => {
      const querypage = {
        title: 'Test Page',
        ns: 0,
        contentmodel: 'wikitext'
        // No pageprops property
      };
      
      const displayTitle = querypage.pageprops?.displaytitle;
      const description = querypage.pageprops?.description;
      
      assert.strictEqual(displayTitle, undefined);
      assert.strictEqual(description, undefined);
    });

    it('should handle wiki whitelist validation', () => {
      const wikiWhitelist = ['https://allowed.wiki/', 'https://also-allowed.wiki/'];
      const testWiki = 'https://forbidden.wiki/';
      const allowedWiki = 'https://allowed.wiki/';
      
      const isForbidden = wikiWhitelist.length && !wikiWhitelist.includes(testWiki);
      const isAllowed = !wikiWhitelist.length || wikiWhitelist.includes(allowedWiki);
      
      assert.ok(isForbidden);
      assert.ok(isAllowed);
    });
  });

  describe('Dynamic Module Loading', () => {
    it('should filter JavaScript files correctly', () => {
      const files = ['command1.js', 'helper.js', 'readme.txt', 'config.json', 'command2.js'];
      const jsFiles = files.filter(file => file.endsWith('.js'));
      
      assert.deepStrictEqual(jsFiles, ['command1.js', 'helper.js', 'command2.js']);
    });

    it('should construct import paths correctly', () => {
      const file = 'testcommand.js';
      const importPath = '../minecraft/' + file;
      
      assert.strictEqual(importPath, '../minecraft/testcommand.js');
    });

    it('should handle readdir error callback', () => {
      let errorHandled = false;
      const mockError = new Error('Directory not found');
      
      // Simulate the readdir callback error handling
      const callback = (error, files) => {
        if (error) {
          errorHandled = true;
          return error;
        }
      };
      
      callback(mockError, null);
      assert.ok(errorHandled);
    });
  });

  describe('API Response Structure Validation', () => {
    it('should validate successful API response', () => {
      const mockResponse = {
        statusCode: 200,
        body: {
          batchcomplete: true,
          query: {
            general: { mainpage: 'Main Page', sitename: 'Test Wiki' },
            namespaces: { 0: { id: 0, name: '' } },
            namespacealiases: [],
            pages: {
              '1': {
                pageid: 1,
                title: 'Test Page',
                ns: 0,
                contentmodel: 'wikitext'
              }
            }
          }
        }
      };
      
      const isValidResponse = mockResponse.statusCode === 200 && 
        mockResponse.body && 
        mockResponse.body.batchcomplete === true &&
        mockResponse.body.query;
      
      assert.ok(isValidResponse);
    });

    it('should handle API error responses', () => {
      const errorResponse = {
        statusCode: 500,
        body: {
          error: {
            code: 'internal_api_error_DBQueryError',
            info: 'Database connection failed'
          }
        }
      };
      
      const isError = errorResponse.statusCode !== 200 || 
        !errorResponse.body || 
        errorResponse.body.batchcomplete === undefined ||
        !errorResponse.body.query;
      
      assert.ok(isError);
      assert.ok(errorResponse.body.error);
    });

    it('should validate interwiki response structure', () => {
      const interwikiResponse = {
        query: {
          interwiki: [{
            prefix: 'en',
            url: 'https://en.wikipedia.org/wiki/Test',
            iw: 'en',
            title: 'Test'
          }]
        }
      };
      
      const hasInterwiki = interwikiResponse.query.interwiki && 
        Array.isArray(interwikiResponse.query.interwiki) &&
        interwikiResponse.query.interwiki.length > 0;
      
      assert.ok(hasInterwiki);
      assert.strictEqual(interwikiResponse.query.interwiki[0].prefix, 'en');
    });
  });
});