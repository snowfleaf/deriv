import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder } from 'discord.js';
import { botLimits } from '../../util/defaults.js';
import { got, escapeFormatting, splitMessage } from '../../util/functions.js';

const { search: searchLimit } = botLimits;

/**
 * Searches a wiki using Discord Components v2 with image support.
 * @param {import('../../util/i18n.js').default} lang - The user language.
 * @param {import('discord.js').Message|import('discord.js').ChatInputCommandInteraction} msg - The Discord message.
 * @param {String} searchterm - The searchterm.
 * @param {import('../../util/wiki.js').default} wiki - The wiki for the search.
 * @param {Object} query - The siteinfo from the wiki.
 * @param {import('discord.js').MessageReaction} reaction - The reaction on the message.
 * @param {String} spoiler - If the response is in a spoiler.
 * @param {Boolean} noEmbed - If the response should be without an embed.
 * @returns {Promise<{reaction?: WB_EMOJI, message?: String|import('discord.js').MessageOptions}>}
 */
export default async function mw_search(lang, msg, searchterm, wiki, query, reaction, spoiler, noEmbed) {
    // Truncate search term if too long
    if (searchterm.length > 250) {
        searchterm = searchterm.substring(0, 250).trim();
        msg?.fetchReply?.().then(message => message?.reactEmoji?.(WB_EMOJI.warning), log_error);
        msg?.reactEmoji?.(WB_EMOJI.warning);
    }

    // Create the search link
    const pagelink = wiki.toLink('Special:Search', { search: searchterm, fulltext: 1 });
    
    // Initialize components array
    const components = [];
    
    // Base message content
    let resultText = '🔍 ' + spoiler + '<' + pagelink + '>' + spoiler;
    
    // If noEmbed is false, we'll use rich components
    if (!noEmbed) {
        // Create title row with wiki name and search term
        const titleRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setLabel(query.general.sitename)
                    .setStyle(ButtonStyle.Link)
                    .setURL(pagelink),
                new ButtonBuilder()
                    .setLabel(`Search: ${searchterm}`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true)
            );
        components.push(titleRow);
    } else {
        resultText += '\n\n**`' + searchterm + '`**';
    }

    // Get the query page info
    const querypage = (Object.values((query.pages || {}))?.[0] || { title: '', ns: 0, invalid: '' };
    const limit = searchLimit[(patreonGuildsPrefix.has(msg.guildId) ? 'patreon' : 'default')];

    try {
        // First search API call
        const response = await got.get(wiki + 'api.php?action=query&titles=Special:Search&list=search&srinfo=totalhits&srprop=redirecttitle|sectiontitle&srnamespace=4|12|14|' + (querypage.ns >= 0 ? querypage.ns + '|' : '') + wiki.namespaces.content.map(ns => ns.id).join('|') + '&srlimit=' + limit + '&srsearch=' + encodeURIComponent(searchterm) + '&format=json', {
            context: {
                guildId: msg.guildId
            }
        });

        let body = response.body;
        if (body?.warnings) log_warning(body.warnings);
        
        // If initial search fails or is incomplete
        if (response.statusCode !== 200 || !body?.query?.search || body.batchcomplete === undefined) {
            console.log('- ' + response.statusCode + ': Error while getting the search results: ' + body?.error?.info);
            return { message: resultText };
        }

        // If we didn't get enough results, try a text search
        if (body.query.search.length < limit) {
            try {
                const tresponse = await got.get(wiki + 'api.php?action=query&list=search&srwhat=text&srinfo=totalhits&srprop=redirecttitle|sectiontitle&srnamespace=4|12|14|' + (querypage.ns >= 0 ? querypage.ns + '|' : '') + wiki.namespaces.content.map(ns => ns.id).join('|') + '&srlimit=' + limit + '&srsearch=' + encodeURIComponent(searchterm) + '&format=json', {
                    context: {
                        guildId: msg.guildId
                    }
                });

                const tbody = tresponse.body;
                if (tbody?.warnings) log_warning(tbody.warnings);

                if (tresponse.statusCode === 200 && tbody?.query?.search && tbody.batchcomplete !== undefined) {
                    // Merge results without duplicates
                    body.query.search.push(...tbody.query.search.filter(tresult => {
                        return !body.query.search.some(result => result.pageid === tresult.pageid);
                    }).slice(0, limit - body.query.search.length));

                    // Combine total hits
                    if (body.query.searchinfo && tbody.query.searchinfo) {
                        body.query.searchinfo.totalhits += tbody.query.searchinfo.totalhits;
                    }
                }
            } catch (error) {
                console.log('- Error while getting the text search results: ' + error);
            }
        }

        // Process search results
        if (!body?.query?.search) return { message: resultText };

        // Update link if we found a matching page
        if (body.query.pages?.['-1']?.title) {
            const newPagelink = wiki.toLink(body.query.pages['-1'].title, { search: searchterm, fulltext: 1 });
            resultText = '🔍 ' + spoiler + '<' + newPagelink + '>' + spoiler;
            if (!noEmbed) {
                // Update the link button in the title row
                components[0].components[0].setURL(newPagelink);
            } else {
                resultText += '\n\n**`' + searchterm + '`**';
            }
        }

        // Process search results into select menu options
        const searchResults = [];
        let hasExactMatch = false;
        let thumbnailUrl = null;

        for (const result of body.query.search) {
            // Check for exact match
            const isExactMatch = result.title.replace(/[_-]/g, ' ').toLowerCase() === querypage.title.replaceAll('-', ' ').toLowerCase();
            
            if (isExactMatch) {
                hasExactMatch = true;
                if (query.redirects?.[0]) {
                    if (query.redirects[0].tofragment && !result.sectiontitle) {
                        result.sectiontitle = query.redirects[0].tofragment;
                    }
                    if (!result.redirecttitle) {
                        result.redirecttitle = query.redirects[0].from;
                    }
                }

                // Try to get thumbnail for exact match
                try {
                    const pageResponse = await got.get(wiki + 'api.php?action=query&prop=pageimages&pithumbsize=300&titles=' + encodeURIComponent(result.title) + '&format=json', {
                        context: {
                            guildId: msg.guildId
                        }
                    });
                    
                    const pageData = pageResponse.body;
                    const page = Object.values(pageData.query?.pages || {})[0];
                    if (page?.thumbnail?.source) {
                        thumbnailUrl = page.thumbnail.source;
                    }
                } catch (error) {
                    console.log('- Error while fetching page thumbnail: ' + error);
                }
            }

            // Format the result for the select menu
            let description = '';
            if (result.sectiontitle) description += `§ ${result.sectiontitle}`;
            if (result.redirecttitle) {
                if (description) description += ' • ';
                description += `⤷ ${result.redirecttitle}`;
            }

            searchResults.push({
                label: result.title.length > 100 ? result.title.substring(0, 97) + '...' : result.title,
                description: description.length > 100 ? description.substring(0, 97) + '...' : description,
                value: result.pageid.toString(),
                url: wiki.toLink(result.title, '', '', true)
            });
        }

        // Handle cases where there's no exact match
        if (!hasExactMatch) {
            if (query.interwiki?.[0]) {
                searchResults.unshift({
                    label: `⤷ ${query.interwiki[0].title}`,
                    description: query.redirects?.[0] ? `⤷ ${query.redirects[0].from}` : 'Interwiki link',
                    value: 'interwiki',
                    url: query.interwiki[0].url
                });
            } else if (querypage.invalid === undefined && (querypage.missing === undefined || querypage.known !== undefined)) {
                let description = '';
                if (query.redirects?.[0]) {
                    if (query.redirects[0].tofragment) {
                        description += `§ ${query.redirects[0].tofragment}`;
                    }
                    description += ` ⤷ ${query.redirects[0].from}`;
                }

                searchResults.unshift({
                    label: querypage.title,
                    description: description,
                    value: 'page',
                    url: wiki.toLink(querypage.title, '', '', true)
                });
            }
        }

        // Create select menu with search results (max 25 options)
        if (searchResults.length > 0) {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`search_results:${msg.author.id}`) // Include user ID to prevent others from interacting
                .setPlaceholder('Select a search result')
                .addOptions(searchResults.slice(0, 25));

            const selectRow = new ActionRowBuilder().addComponents(selectMenu);
            components.push(selectRow);

            // Add navigation buttons if there are more results
            if (searchResults.length > 25) {
                const navRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`search_prev:${msg.author.id}`)
                            .setLabel('Previous')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(true), // Disabled initially as we're on first page
                        new ButtonBuilder()
                            .setLabel('View All')
                            .setStyle(ButtonStyle.Link)
                            .setURL(pagelink),
                        new ButtonBuilder()
                            .setCustomId(`search_next:${msg.author.id}`)
                            .setLabel('Next')
                            .setStyle(ButtonStyle.Primary)
                    );
                components.push(navRow);
            }
        }

        // Add footer with result count
        if (body.query.searchinfo) {
            const footer = lang.get('search.results', 
                body.query.searchinfo.totalhits.toLocaleString(lang.get('dateformat')), 
                body.query.searchinfo.totalhits);

            const footerRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel(footer)
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true)
                );
            components.push(footerRow);
        }

        // Prepare the final message
        const messageOptions = {
            content: resultText,
            components: components
        };

        // Add embed with thumbnail if we found an image and noEmbed is false
        if (!noEmbed && thumbnailUrl) {
            const embed = new EmbedBuilder()
                .setTitle('Preview Image')
                .setImage(thumbnailUrl)
                .setColor(0x00AE86);
            messageOptions.embeds = [embed];
        }

        return { message: messageOptions };

    } catch (error) {
        console.log('- Error while getting the search results: ' + error);
        return { message: resultText };
    }
}
