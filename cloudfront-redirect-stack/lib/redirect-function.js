import cf from 'cloudfront';

// This fails if there is no key value store associated with the function
const kvsHandle = cf.kvs();
//

// Remember to associate the KVS with your function before referencing KVS in your code.
// https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions-associate.html
async function handler(event) {
    const request = event.request;
    // Use the first segment of the pathname as key
    // For example http(s)://domain/<key>/something/else
    const pathSegments = request.uri.split('/')
    
    const key = pathSegments[pathSegments.length - 1]
    try {
        // Replace the first path of the pathname with the value of the key
        // For example http(s)://domain/<value>/something/else
        const destinationURL = await kvsHandle.get(key);
        var response = {
            statusCode: 302,
            statusDescription: 'Found',
            headers: {
                'cloudfront-functions': { value: 'generated-by-CloudFront-Functions' },
                'location': { value: destinationURL }
            }
        };
        
    } catch (err) {
        // No change to the pathname if the key is not found. Adding some more lines
        console.log(`${request.uri} | ${err}`);
    }
    return response;
}