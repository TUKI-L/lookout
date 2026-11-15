// Finds a current 24/7 YouTube live camera for each famous place below and writes public/data/youtube.json.
// Live stream IDs change when a channel restarts its stream, so re-run this now and then:
//   node scripts/curate-youtube.mjs && node scripts/build-cameras.mjs

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'youtube.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

// [search query, display place, lat, lon, category]
const PLACES = [
  ['Times Square live cam', 'Times Square, New York', 40.758, -73.9855, 'city'],
  ['Brooklyn Bridge live cam', 'Brooklyn Bridge, New York', 40.7061, -73.9969, 'city'],
  ['Las Vegas strip live cam', 'Las Vegas Strip, Nevada', 36.1147, -115.1728, 'city'],
  ['Hollywood Hills live cam', 'Los Angeles, California', 34.1341, -118.3215, 'city'],
  ['San Francisco Golden Gate live cam', 'Golden Gate, San Francisco', 37.8199, -122.4783, 'city'],
  ['Chicago skyline live cam', 'Chicago, Illinois', 41.8781, -87.6298, 'city'],
  ['New Orleans Bourbon Street live cam', 'Bourbon Street, New Orleans', 29.9584, -90.0651, 'city'],
  ['Nashville Broadway live cam', 'Broadway, Nashville', 36.1612, -86.7775, 'city'],
  ['Key West Duval Street live cam', 'Key West, Florida', 24.5551, -81.8007, 'city'],
  ['Miami Beach live cam', 'Miami Beach, Florida', 25.7907, -80.13, 'beach'],
  ['Seattle Space Needle live cam', 'Seattle, Washington', 47.6205, -122.3493, 'city'],
  ['Niagara Falls live cam', 'Niagara Falls', 43.0896, -79.0849, 'nature'],
  ['Old Faithful live cam', 'Yellowstone, Wyoming', 44.4605, -110.8281, 'nature'],
  ['Honolulu Waikiki live cam', 'Waikiki, Hawaii', 21.2793, -157.8292, 'beach'],
  ['Kilauea volcano live cam', 'Kīlauea, Hawaii', 19.4069, -155.2834, 'nature'],
  ['Banff live cam', 'Banff, Alberta', 51.1784, -115.5708, 'nature'],
  ['Toronto CN Tower live cam', 'Toronto, Ontario', 43.6426, -79.3871, 'city'],
  ['Vancouver harbour live cam', 'Vancouver, BC', 49.2888, -123.1111, 'city'],
  ['Anchorage Alaska live cam', 'Anchorage, Alaska', 61.2181, -149.9003, 'city'],
  ['Katmai bear cam live', 'Brooks Falls, Alaska', 58.5546, -155.7782, 'nature'],
  ['Northern lights live cam Yellowknife', 'Yellowknife, Canada', 62.454, -114.3718, 'weather'],
  ['Mexico City zocalo live cam', 'Mexico City', 19.4326, -99.1332, 'city'],
  ['Cancun beach live cam', 'Cancún, Mexico', 21.1619, -86.8515, 'beach'],
  ['Havana live cam', 'Havana, Cuba', 23.1136, -82.3666, 'city'],
  ['Panama canal live cam', 'Panama Canal', 9.0802, -79.6808, 'transport'],
  ['Rio de Janeiro Copacabana live cam', 'Copacabana, Rio de Janeiro', -22.9711, -43.1822, 'beach'],
  ['Buenos Aires live cam', 'Buenos Aires', -34.6037, -58.3816, 'city'],
  ['London Abbey Road live cam', 'Abbey Road, London', 51.532, -0.1779, 'city'],
  ['London Tower Bridge live cam', 'Tower Bridge, London', 51.5055, -0.0754, 'city'],
  ['Dublin Temple Bar live cam', 'Dublin, Ireland', 53.3455, -6.2643, 'city'],
  ['Edinburgh live cam', 'Edinburgh, Scotland', 55.9533, -3.1883, 'city'],
  ['Paris Eiffel Tower live cam', 'Eiffel Tower, Paris', 48.8584, 2.2945, 'city'],
  ['Amsterdam canal live cam', 'Amsterdam', 52.3676, 4.9041, 'city'],
  ['Venice Grand Canal live cam', 'Venice, Italy', 45.4408, 12.3155, 'city'],
  ['Rome Trevi Fountain live cam', 'Rome, Italy', 41.9009, 12.4833, 'city'],
  ['Mount Etna live cam', 'Mount Etna, Sicily', 37.751, 14.9934, 'nature'],
  ['Naples Vesuvius live cam', 'Naples, Italy', 40.8518, 14.2681, 'city'],
  ['Barcelona live cam', 'Barcelona, Spain', 41.3874, 2.1686, 'city'],
  ['Madrid Puerta del Sol live cam', 'Madrid, Spain', 40.4168, -3.7038, 'city'],
  ['Lisbon live cam', 'Lisbon, Portugal', 38.7223, -9.1393, 'city'],
  ['Prague Old Town Square live cam', 'Prague, Czechia', 50.0875, 14.4213, 'city'],
  ['Zermatt Matterhorn live cam', 'Zermatt, Switzerland', 46.0207, 7.7491, 'nature'],
  ['Munich Marienplatz live cam', 'Munich, Germany', 48.1374, 11.5755, 'city'],
  ['Berlin live cam', 'Berlin, Germany', 52.52, 13.405, 'city'],
  ['Vienna live cam', 'Vienna, Austria', 48.2082, 16.3738, 'city'],
  ['Budapest live cam', 'Budapest, Hungary', 47.4979, 19.0402, 'city'],
  ['Santorini live cam', 'Santorini, Greece', 36.3932, 25.4615, 'beach'],
  ['Athens Acropolis live cam', 'Athens, Greece', 37.9715, 23.7257, 'city'],
  ['Istanbul Bosphorus live cam', 'Istanbul, Türkiye', 41.0082, 28.9784, 'city'],
  ['Reykjavik live cam', 'Reykjavík, Iceland', 64.1466, -21.9426, 'city'],
  ['Iceland volcano live cam', 'Reykjanes, Iceland', 63.88, -22.45, 'nature'],
  ['Tromso northern lights live cam', 'Tromsø, Norway', 69.6496, 18.956, 'weather'],
  ['Stockholm live cam', 'Stockholm, Sweden', 59.3293, 18.0686, 'city'],
  ['Copenhagen Nyhavn live cam', 'Copenhagen, Denmark', 55.6798, 12.5911, 'city'],
  ['Helsinki live cam', 'Helsinki, Finland', 60.1699, 24.9384, 'city'],
  ['Rovaniemi Santa Claus village live cam', 'Rovaniemi, Finland', 66.5436, 25.8473, 'city'],
  ['Moscow Red Square live cam', 'Moscow, Russia', 55.7539, 37.6208, 'city'],
  ['Kyiv live cam', 'Kyiv, Ukraine', 50.4501, 30.5234, 'city'],
  ['Jerusalem Western Wall live cam', 'Jerusalem', 31.7767, 35.2345, 'city'],
  ['Mecca live', 'Mecca, Saudi Arabia', 21.4225, 39.8262, 'city'],
  ['Dubai live cam', 'Dubai, UAE', 25.1972, 55.2744, 'city'],
  ['Cairo live cam', 'Cairo, Egypt', 30.0444, 31.2357, 'city'],
  ['Africam live cam safari', 'Kruger region, South Africa', -24.0, 31.5, 'nature'],
  ['Kenya Mpala waterhole live cam', 'Laikipia, Kenya', 0.29, 36.9, 'nature'],
  ['Namibia desert waterhole live cam', 'Namib Desert, Namibia', -26.72, 15.95, 'nature'],
  ['Cape Town live cam', 'Cape Town, South Africa', -33.9249, 18.4241, 'city'],
  ['Mumbai live cam', 'Mumbai, India', 19.076, 72.8777, 'city'],
  ['Varanasi ghat live cam', 'Varanasi, India', 25.3176, 82.9739, 'city'],
  ['Kathmandu live cam', 'Kathmandu, Nepal', 27.7172, 85.324, 'city'],
  ['Mount Everest live cam', 'Everest region, Nepal', 27.9881, 86.925, 'nature'],
  ['Bangkok live cam', 'Bangkok, Thailand', 13.7563, 100.5018, 'city'],
  ['Phuket Patong beach live cam', 'Patong, Phuket', 7.8961, 98.2966, 'beach'],
  ['Bali beach live cam', 'Bali, Indonesia', -8.7181, 115.1686, 'beach'],
  ['Singapore Marina Bay live cam', 'Marina Bay, Singapore', 1.2834, 103.8607, 'city'],
  ['Hong Kong Victoria Harbour live cam', 'Victoria Harbour, Hong Kong', 22.2934, 114.1714, 'city'],
  ['Taipei live cam', 'Taipei, Taiwan', 25.033, 121.5654, 'city'],
  ['Seoul live cam', 'Seoul, South Korea', 37.5665, 126.978, 'city'],
  ['Busan Haeundae live cam', 'Busan, South Korea', 35.1587, 129.1604, 'beach'],
  ['Shibuya scramble crossing live camera', 'Shibuya Crossing, Tokyo', 35.6595, 139.7005, 'city'],
  ['Shinjuku Kabukicho live camera', 'Shinjuku, Tokyo', 35.6938, 139.7034, 'city'],
  ['Osaka Dotonbori live camera', 'Dotonbori, Osaka', 34.6687, 135.5013, 'city'],
  ['Kyoto live camera', 'Kyoto, Japan', 35.0116, 135.7681, 'city'],
  ['Mount Fuji live camera', 'Mount Fuji, Japan', 35.3606, 138.7274, 'nature'],
  ['Sakurajima volcano live camera', 'Sakurajima, Japan', 31.5809, 130.6571, 'nature'],
  ['Sapporo live camera', 'Sapporo, Japan', 43.0618, 141.3545, 'city'],
  ['Okinawa beach live camera', 'Okinawa, Japan', 26.2124, 127.6809, 'beach'],
  ['Sydney Harbour live cam', 'Sydney Harbour, Australia', -33.8568, 151.2153, 'city'],
  ['Bondi beach live cam', 'Bondi Beach, Sydney', -33.8915, 151.2767, 'beach'],
  ['Gold Coast live cam', 'Gold Coast, Australia', -28.0167, 153.4, 'beach'],
  ['Melbourne live cam', 'Melbourne, Australia', -37.8136, 144.9631, 'city'],
  ['Auckland live cam', 'Auckland, New Zealand', -36.8485, 174.7633, 'city'],
  ['Queenstown New Zealand live cam', 'Queenstown, New Zealand', -45.0312, 168.6626, 'nature'],
  ['Antarctica live cam', 'Antarctica', -77.85, 166.67, 'nature'],
  ['International Space Station live earth view', 'ISS (Earth orbit)', 0, -30, 'nature'],
  ['Frankfurt airport live planespotting', 'Frankfurt Airport', 50.0379, 8.5622, 'transport'],
  ['Amsterdam Schiphol live planespotting', 'Schiphol Airport', 52.3105, 4.7683, 'transport'],
  ['LAX airport live cam', 'Los Angeles Intl Airport', 33.9416, -118.4085, 'transport'],
  ['St Maarten Maho beach live cam', 'Maho Beach, Sint Maarten', 18.0405, -63.1194, 'transport'],
  ['Shinkansen live camera', 'Tokaido Shinkansen, Japan', 34.96, 138.4, 'transport'],
  ['Port of Rotterdam live cam', 'Port of Rotterdam', 51.9496, 4.1453, 'transport'],
  ['Monterey Bay aquarium live cam', 'Monterey Bay, California', 36.6182, -121.9019, 'nature'],
  ['Decorah eagle nest live cam', 'Decorah, Iowa', 43.3033, -91.7857, 'nature'],
  ['Jackson Hole town square live cam', 'Jackson Hole, Wyoming', 43.4799, -110.7624, 'city'],
  ['Aspen live cam', 'Aspen, Colorado', 39.1911, -106.8175, 'nature'],
  // --- more of the world ---
  ['Boston live cam', 'Boston, Massachusetts', 42.3601, -71.0589, 'city'],
  ['Washington DC live cam', 'Washington, DC', 38.8899, -77.0091, 'city'],
  ['Philadelphia live cam', 'Philadelphia, Pennsylvania', 39.9526, -75.1652, 'city'],
  ['Atlanta live cam', 'Atlanta, Georgia', 33.749, -84.388, 'city'],
  ['Austin Texas live cam', 'Austin, Texas', 30.2672, -97.7431, 'city'],
  ['Denver live cam', 'Denver, Colorado', 39.7392, -104.9903, 'city'],
  ['San Diego live cam', 'San Diego, California', 32.7157, -117.1611, 'beach'],
  ['Santa Monica pier live cam', 'Santa Monica, California', 34.0094, -118.4973, 'beach'],
  ['Huntington Beach live cam', 'Huntington Beach, California', 33.6553, -118.0047, 'beach'],
  ['Lake Tahoe live cam', 'Lake Tahoe', 39.0968, -120.0324, 'nature'],
  ['Grand Canyon live cam', 'Grand Canyon, Arizona', 36.0544, -112.1401, 'nature'],
  ['Myrtle Beach live cam', 'Myrtle Beach, South Carolina', 33.6891, -78.8867, 'beach'],
  ['Clearwater Beach live cam', 'Clearwater Beach, Florida', 27.9775, -82.8271, 'beach'],
  ['Daytona Beach live cam', 'Daytona Beach, Florida', 29.2108, -81.0228, 'beach'],
  ['Cape Canaveral launch live cam', 'Cape Canaveral, Florida', 28.3922, -80.6077, 'transport'],
  ['Galveston live cam', 'Galveston, Texas', 29.3013, -94.7977, 'beach'],
  ['Ocean City Maryland live cam', 'Ocean City, Maryland', 38.3365, -75.0849, 'beach'],
  ['Montreal live cam', 'Montreal, Quebec', 45.5019, -73.5674, 'city'],
  ['Quebec City live cam', 'Quebec City', 46.8139, -71.208, 'city'],
  ['Puerto Rico San Juan live cam', 'San Juan, Puerto Rico', 18.4655, -66.1057, 'beach'],
  ['Aruba live cam', 'Aruba', 12.5211, -69.9683, 'beach'],
  ['Bahamas Nassau live cam', 'Nassau, Bahamas', 25.0443, -77.3504, 'beach'],
  ['Costa Rica live cam', 'Costa Rica', 9.7489, -83.7534, 'nature'],
  ['Lima Peru live cam', 'Lima, Peru', -12.0464, -77.0428, 'city'],
  ['Santiago Chile live cam', 'Santiago, Chile', -33.4489, -70.6693, 'city'],
  ['Bogota live cam', 'Bogotá, Colombia', 4.711, -74.0721, 'city'],
  ['Sao Paulo live cam', 'São Paulo, Brazil', -23.5505, -46.6333, 'city'],
  ['Florianopolis live cam', 'Florianópolis, Brazil', -27.5954, -48.548, 'beach'],
  ['Brighton beach live cam', 'Brighton, England', 50.8198, -0.1372, 'beach'],
  ['Liverpool live cam', 'Liverpool, England', 53.4084, -2.9916, 'city'],
  ['Manchester live cam', 'Manchester, England', 53.4808, -2.2426, 'city'],
  ['Cornwall live cam', 'Cornwall, England', 50.266, -5.0527, 'beach'],
  ['Galway live cam', 'Galway, Ireland', 53.2707, -9.0568, 'city'],
  ['Nice France live cam', 'Nice, France', 43.7102, 7.262, 'beach'],
  ['Chamonix live cam', 'Chamonix, France', 45.9237, 6.8694, 'nature'],
  ['Marseille live cam', 'Marseille, France', 43.2965, 5.3698, 'city'],
  ['Brussels live cam', 'Brussels, Belgium', 50.8503, 4.3517, 'city'],
  ['Bruges live cam', 'Bruges, Belgium', 51.2093, 3.2247, 'city'],
  ['Hamburg live cam', 'Hamburg, Germany', 53.5511, 9.9937, 'city'],
  ['Cologne cathedral live cam', 'Cologne, Germany', 50.9413, 6.9583, 'city'],
  ['Zurich live cam', 'Zürich, Switzerland', 47.3769, 8.5417, 'city'],
  ['Jungfraujoch live cam', 'Jungfraujoch, Switzerland', 46.5475, 7.9853, 'nature'],
  ['Salzburg live cam', 'Salzburg, Austria', 47.8095, 13.055, 'city'],
  ['Innsbruck live cam', 'Innsbruck, Austria', 47.2692, 11.4041, 'nature'],
  ['Dubrovnik live cam', 'Dubrovnik, Croatia', 42.6507, 18.0944, 'city'],
  ['Split Croatia live cam', 'Split, Croatia', 43.5081, 16.4402, 'beach'],
  ['Lake Como live cam', 'Lake Como, Italy', 45.9937, 9.2575, 'nature'],
  ['Florence live cam', 'Florence, Italy', 43.7696, 11.2558, 'city'],
  ['Milan Duomo live cam', 'Milan, Italy', 45.4642, 9.19, 'city'],
  ['Positano live cam', 'Positano, Italy', 40.6281, 14.4849, 'beach'],
  ['Mallorca live cam', 'Mallorca, Spain', 39.6953, 3.0176, 'beach'],
  ['Tenerife live cam', 'Tenerife, Spain', 28.2916, -16.6291, 'beach'],
  ['Seville live cam', 'Seville, Spain', 37.3891, -5.9845, 'city'],
  ['Porto live cam', 'Porto, Portugal', 41.1579, -8.6291, 'city'],
  ['Madeira live cam', 'Madeira, Portugal', 32.7607, -16.9595, 'nature'],
  ['Warsaw live cam', 'Warsaw, Poland', 52.2297, 21.0122, 'city'],
  ['Krakow live cam', 'Kraków, Poland', 50.0647, 19.945, 'city'],
  ['Riga live cam', 'Riga, Latvia', 56.9496, 24.1052, 'city'],
  ['Tallinn live cam', 'Tallinn, Estonia', 59.437, 24.7536, 'city'],
  ['Oslo live cam', 'Oslo, Norway', 59.9139, 10.7522, 'city'],
  ['Bergen live cam', 'Bergen, Norway', 60.3913, 5.3221, 'city'],
  ['Lofoten live cam', 'Lofoten, Norway', 68.2, 14.1, 'nature'],
  ['Svalbard live cam', 'Svalbard', 78.2232, 15.6267, 'nature'],
  ['Mykonos live cam', 'Mykonos, Greece', 37.4467, 25.3289, 'beach'],
  ['Antalya live cam', 'Antalya, Türkiye', 36.8969, 30.7133, 'beach'],
  ['Tbilisi live cam', 'Tbilisi, Georgia', 41.7151, 44.8271, 'city'],
  ['Tel Aviv beach live cam', 'Tel Aviv, Israel', 32.0853, 34.7818, 'beach'],
  ['Abu Dhabi live cam', 'Abu Dhabi, UAE', 24.4539, 54.3773, 'city'],
  ['Doha live cam', 'Doha, Qatar', 25.2854, 51.531, 'city'],
  ['Marrakech live cam', 'Marrakech, Morocco', 31.6295, -7.9811, 'city'],
  ['Nairobi live cam', 'Nairobi, Kenya', -1.2921, 36.8219, 'city'],
  ['Zanzibar live cam', 'Zanzibar', -6.1659, 39.2026, 'beach'],
  ['Mauritius live cam', 'Mauritius', -20.3484, 57.5522, 'beach'],
  ['Maldives live cam', 'Maldives', 3.2028, 73.2207, 'beach'],
  ['Goa beach live cam', 'Goa, India', 15.2993, 74.124, 'beach'],
  ['Delhi live cam', 'Delhi, India', 28.6139, 77.209, 'city'],
  ['Ho Chi Minh City live cam', 'Ho Chi Minh City, Vietnam', 10.8231, 106.6297, 'city'],
  ['Hanoi live cam', 'Hanoi, Vietnam', 21.0278, 105.8342, 'city'],
  ['Kuala Lumpur live cam', 'Kuala Lumpur, Malaysia', 3.139, 101.6869, 'city'],
  ['Manila live cam', 'Manila, Philippines', 14.5995, 120.9842, 'city'],
  ['Jakarta live cam', 'Jakarta, Indonesia', -6.2088, 106.8456, 'city'],
  ['Pattaya live cam', 'Pattaya, Thailand', 12.9236, 100.8825, 'beach'],
  ['Chiang Mai live cam', 'Chiang Mai, Thailand', 18.7883, 98.9853, 'city'],
  ['Shanghai Bund live cam', 'Shanghai, China', 31.2304, 121.4737, 'city'],
  ['Macau live cam', 'Macau', 22.1987, 113.5439, 'city'],
  ['Yokohama live camera', 'Yokohama, Japan', 35.4437, 139.638, 'city'],
  ['Nagoya live camera', 'Nagoya, Japan', 35.1815, 136.9066, 'city'],
  ['Fukuoka live camera', 'Fukuoka, Japan', 33.5904, 130.4017, 'city'],
  ['Hiroshima live camera', 'Hiroshima, Japan', 34.3853, 132.4553, 'city'],
  ['Nara deer live camera', 'Nara, Japan', 34.6851, 135.8048, 'nature'],
  ['Tokyo Skytree live camera', 'Tokyo Skytree, Japan', 35.7101, 139.8107, 'city'],
  ['Akihabara live camera', 'Akihabara, Tokyo', 35.6984, 139.7731, 'city'],
  ['Haneda airport live camera', 'Haneda Airport, Tokyo', 35.5494, 139.7798, 'transport'],
  ['Jeju island live cam', 'Jeju, South Korea', 33.4996, 126.5312, 'beach'],
  ['Perth live cam', 'Perth, Australia', -31.9505, 115.8605, 'city'],
  ['Brisbane live cam', 'Brisbane, Australia', -27.4698, 153.0251, 'city'],
  ['Byron Bay live cam', 'Byron Bay, Australia', -28.6474, 153.602, 'beach'],
  ['Cairns live cam', 'Cairns, Australia', -16.9186, 145.7781, 'beach'],
  ['Wellington live cam', 'Wellington, New Zealand', -41.2865, 174.7762, 'city'],
  ['Fiji live cam', 'Fiji', -17.7134, 178.065, 'beach'],
  ['Tahiti live cam', 'Tahiti, French Polynesia', -17.6509, -149.426, 'beach'],
  // --- ski & mountains ---
  ['Whistler live cam', 'Whistler, BC', 50.1163, -122.9574, 'nature'],
  ['Vail live cam', 'Vail, Colorado', 39.6403, -106.3742, 'nature'],
  ['Breckenridge live cam', 'Breckenridge, Colorado', 39.4817, -106.0384, 'nature'],
  ['Park City live cam', 'Park City, Utah', 40.6461, -111.498, 'nature'],
  ['Mammoth Mountain live cam', 'Mammoth Lakes, California', 37.6485, -118.9721, 'nature'],
  ['Big Sky live cam', 'Big Sky, Montana', 45.2847, -111.4013, 'nature'],
  ['Mount Rainier live cam', 'Mount Rainier, Washington', 46.8523, -121.7603, 'nature'],
  ['Mount Washington live cam', 'Mount Washington, New Hampshire', 44.2706, -71.3033, 'weather'],
  ['St Moritz live cam', 'St. Moritz, Switzerland', 46.4908, 9.8355, 'nature'],
  ['Grindelwald live cam', 'Grindelwald, Switzerland', 46.6242, 8.0414, 'nature'],
  ['Verbier live cam', 'Verbier, Switzerland', 46.0961, 7.2286, 'nature'],
  ['Val d Isere live cam', "Val d'Isère, France", 45.4485, 6.98, 'nature'],
  ['Courchevel live cam', 'Courchevel, France', 45.4154, 6.6343, 'nature'],
  ['Cortina d Ampezzo live cam', "Cortina d'Ampezzo, Italy", 46.5405, 12.1357, 'nature'],
  ['Dolomites live cam', 'Dolomites, Italy', 46.4102, 11.844, 'nature'],
  ['Kitzbuhel live cam', 'Kitzbühel, Austria', 47.4492, 12.3925, 'nature'],
  ['Ischgl live cam', 'Ischgl, Austria', 47.0127, 10.2896, 'nature'],
  ['Garmisch Zugspitze live cam', 'Zugspitze, Germany', 47.4211, 10.9853, 'nature'],
  ['Niseko live camera', 'Niseko, Japan', 42.8048, 140.6874, 'nature'],
  ['Hakuba live camera', 'Hakuba, Japan', 36.6982, 137.8619, 'nature'],
  // --- coasts, harbours & islands ---
  ['Cape Cod live cam', 'Cape Cod, Massachusetts', 41.6688, -70.2962, 'beach'],
  ['Outer Banks live cam', 'Outer Banks, North Carolina', 35.5585, -75.4665, 'beach'],
  ['Virginia Beach live cam', 'Virginia Beach, Virginia', 36.8529, -75.978, 'beach'],
  ['Atlantic City live cam', 'Atlantic City, New Jersey', 39.3643, -74.4229, 'beach'],
  ['Hilton Head live cam', 'Hilton Head, South Carolina', 32.2163, -80.7526, 'beach'],
  ['Destin Florida live cam', 'Destin, Florida', 30.3935, -86.4958, 'beach'],
  ['Panama City Beach live cam', 'Panama City Beach, Florida', 30.1766, -85.8055, 'beach'],
  ['Fort Lauderdale live cam', 'Fort Lauderdale, Florida', 26.1224, -80.1373, 'beach'],
  ['South Padre Island live cam', 'South Padre Island, Texas', 26.1118, -97.1681, 'beach'],
  ['Maui live cam', 'Maui, Hawaii', 20.7984, -156.3319, 'beach'],
  ['Kauai live cam', 'Kauai, Hawaii', 22.0964, -159.5261, 'beach'],
  ['Laguna Beach live cam', 'Laguna Beach, California', 33.5427, -117.7854, 'beach'],
  ['Malibu live cam', 'Malibu, California', 34.0259, -118.7798, 'beach'],
  ['Santa Cruz live cam', 'Santa Cruz, California', 36.9741, -122.0308, 'beach'],
  ['Cannon Beach live cam', 'Cannon Beach, Oregon', 45.8918, -123.9615, 'beach'],
  ['Halifax harbour live cam', 'Halifax, Nova Scotia', 44.6488, -63.5752, 'city'],
  ['Puerto Vallarta live cam', 'Puerto Vallarta, Mexico', 20.6534, -105.2253, 'beach'],
  ['Cabo San Lucas live cam', 'Cabo San Lucas, Mexico', 22.8905, -109.9167, 'beach'],
  ['Playa del Carmen live cam', 'Playa del Carmen, Mexico', 20.6296, -87.0739, 'beach'],
  ['Tulum live cam', 'Tulum, Mexico', 20.2114, -87.4654, 'beach'],
  ['Punta Cana live cam', 'Punta Cana, Dominican Republic', 18.5601, -68.3725, 'beach'],
  ['Barbados live cam', 'Barbados', 13.1939, -59.5432, 'beach'],
  ['Curacao live cam', 'Curaçao', 12.1696, -68.99, 'beach'],
  ['Bonaire live cam', 'Bonaire', 12.2019, -68.2624, 'beach'],
  ['Cayman Islands live cam', 'Grand Cayman', 19.3133, -81.2546, 'beach'],
  ['Jamaica Negril live cam', 'Negril, Jamaica', 18.2683, -78.3486, 'beach'],
  ['Saint Lucia live cam', 'Saint Lucia', 13.9094, -60.9789, 'beach'],
  ['Bermuda live cam', 'Bermuda', 32.3078, -64.7505, 'beach'],
  ['Algarve live cam', 'Algarve, Portugal', 37.0179, -7.9304, 'beach'],
  ['Ibiza live cam', 'Ibiza, Spain', 38.9067, 1.4206, 'beach'],
  ['Benidorm live cam', 'Benidorm, Spain', 38.5411, -0.1225, 'beach'],
  ['Gran Canaria live cam', 'Gran Canaria, Spain', 27.9202, -15.5474, 'beach'],
  ['San Sebastian live cam', 'San Sebastián, Spain', 43.3183, -1.9812, 'beach'],
  ['Biarritz live cam', 'Biarritz, France', 43.4832, -1.5586, 'beach'],
  ['Saint-Tropez live cam', 'Saint-Tropez, France', 43.2727, 6.6406, 'beach'],
  ['Monaco live cam', 'Monaco', 43.7384, 7.4246, 'city'],
  ['Cinque Terre live cam', 'Cinque Terre, Italy', 44.1461, 9.6439, 'beach'],
  ['Sardinia live cam', 'Sardinia, Italy', 40.1209, 9.0129, 'beach'],
  ['Capri live cam', 'Capri, Italy', 40.5532, 14.2222, 'beach'],
  ['Malta live cam', 'Malta', 35.8989, 14.5146, 'beach'],
  ['Crete live cam', 'Crete, Greece', 35.2401, 24.8093, 'beach'],
  ['Corfu live cam', 'Corfu, Greece', 39.6243, 19.9217, 'beach'],
  ['Rhodes live cam', 'Rhodes, Greece', 36.4341, 28.2176, 'beach'],
  ['Bodrum live cam', 'Bodrum, Türkiye', 37.0344, 27.4305, 'beach'],
  ['Cyprus live cam', 'Cyprus', 34.9175, 33.6292, 'beach'],
  ['Sylt live cam', 'Sylt, Germany', 54.9079, 8.3175, 'beach'],
  ['Scheveningen live cam', 'Scheveningen, Netherlands', 52.1107, 4.2805, 'beach'],
  ['Phi Phi island live cam', 'Koh Phi Phi, Thailand', 7.7407, 98.7784, 'beach'],
  ['Boracay live cam', 'Boracay, Philippines', 11.9674, 121.9248, 'beach'],
  ['Da Nang beach live cam', 'Da Nang, Vietnam', 16.0544, 108.2022, 'beach'],
  ['Langkawi live cam', 'Langkawi, Malaysia', 6.35, 99.8, 'beach'],
  ['Seychelles live cam', 'Seychelles', -4.6796, 55.492, 'beach'],
  ['Durban beach live cam', 'Durban, South Africa', -29.8587, 31.0218, 'beach'],
  ['Noosa live cam', 'Noosa, Australia', -26.3986, 153.0909, 'beach'],
  ['Manly beach live cam', 'Manly, Sydney', -33.7969, 151.2878, 'beach'],
  ['Mount Maunganui live cam', 'Mount Maunganui, New Zealand', -37.6316, 176.1716, 'beach'],
  ['Hamburg port live cam', 'Port of Hamburg, Germany', 53.5413, 9.9668, 'transport'],
  ['Port of Los Angeles live cam', 'Port of Los Angeles', 33.7361, -118.2639, 'transport'],
  ['Port Miami cruise live cam', 'PortMiami, Florida', 25.7781, -80.1794, 'transport'],
  ['Port Everglades live cam', 'Port Everglades, Florida', 26.0918, -80.1193, 'transport'],
  ['Duluth ship canal live cam', 'Duluth, Minnesota', 46.7795, -92.0929, 'transport'],
  ['Sault Ste Marie locks live cam', 'Soo Locks, Michigan', 46.5036, -84.3505, 'transport'],
  ['Kiel canal live cam', 'Kiel Canal, Germany', 54.3647, 10.1407, 'transport'],
  ['Bosphorus ship live cam', 'Bosphorus Strait, Istanbul', 41.0854, 29.0563, 'transport'],
  ['Suez canal live cam', 'Suez Canal, Egypt', 30.5852, 32.2654, 'transport'],
  // --- airports & rail ---
  ['Heathrow airport live', 'Heathrow Airport, London', 51.47, -0.4543, 'transport'],
  ['Atlanta airport live cam', 'Atlanta Airport', 33.6407, -84.4277, 'transport'],
  ['Chicago O Hare live cam', "O'Hare Airport, Chicago", 41.9742, -87.9073, 'transport'],
  ['JFK airport live cam', 'JFK Airport, New York', 40.6413, -73.7781, 'transport'],
  ['Dubai airport live', 'Dubai International Airport', 25.2532, 55.3657, 'transport'],
  ['Zurich airport live', 'Zürich Airport', 47.4582, 8.5555, 'transport'],
  ['Madrid airport live', 'Madrid-Barajas Airport', 40.4983, -3.5676, 'transport'],
  ['Sydney airport live', 'Sydney Airport', -33.9399, 151.1753, 'transport'],
  ['Las Vegas airport live', 'Harry Reid Airport, Las Vegas', 36.084, -115.1537, 'transport'],
  ['Toronto Pearson airport live', 'Toronto Pearson Airport', 43.6777, -79.6248, 'transport'],
  ['Railcam live Rochelle Illinois', 'Rochelle, Illinois', 41.9239, -89.0687, 'transport'],
  ['Railcam live La Plata Missouri', 'La Plata, Missouri', 40.0234, -92.4913, 'transport'],
  ['Railcam live Horseshoe Curve', 'Horseshoe Curve, Pennsylvania', 40.4975, -78.4842, 'transport'],
  ['Swiss railway live cam', 'Swiss Alps railway', 46.5, 8.0, 'transport'],
  // --- wildlife & nature ---
  ['Yellowstone live cam', 'Yellowstone, Wyoming', 44.428, -110.5885, 'nature'],
  ['Great Smoky Mountains live cam', 'Great Smoky Mountains, Tennessee', 35.6118, -83.4895, 'nature'],
  ['Yosemite live cam', 'Yosemite, California', 37.8651, -119.5383, 'nature'],
  ['Glacier National Park live cam', 'Glacier National Park, Montana', 48.7596, -113.787, 'nature'],
  ['Mount St Helens live cam', 'Mount St. Helens, Washington', 46.1914, -122.1956, 'nature'],
  ['Denali live cam', 'Denali, Alaska', 63.1148, -151.1926, 'nature'],
  ['Churchill polar bear live cam', 'Churchill, Manitoba', 58.7684, -94.165, 'nature'],
  ['Florida manatee live cam', 'Blue Spring, Florida', 28.9472, -81.3398, 'nature'],
  ['Osprey nest live cam Scotland', 'Loch of the Lowes, Scotland', 56.578, -3.548, 'nature'],
  ['Puffin live cam', 'Machias Seal Island', 44.501, -67.101, 'nature'],
  ['Panda live cam Chengdu', 'Chengdu, China', 30.7333, 104.1446, 'nature'],
  ['San Diego zoo live cam', 'San Diego Zoo', 32.7353, -117.149, 'nature'],
  ['Smithsonian zoo live cam', 'National Zoo, Washington DC', 38.9296, -77.0498, 'nature'],
  ['Great Barrier Reef live cam', 'Great Barrier Reef, Australia', -18.2871, 147.6992, 'nature'],
  ['Aquarium live cam Georgia', 'Georgia Aquarium, Atlanta', 33.7634, -84.3951, 'nature'],
  ['Amazon rainforest live cam', 'Amazon rainforest, Brazil', -3.4653, -62.2159, 'nature'],
  ['Botswana live cam waterhole', 'Okavango Delta, Botswana', -19.2833, 22.9, 'nature'],
  ['Tembe elephant park live cam', 'Tembe Elephant Park, South Africa', -26.9667, 32.5, 'nature'],
  ['Djuma live cam', 'Sabi Sand, South Africa', -24.75, 31.4, 'nature'],
  ['Norway fjord live cam', 'Geirangerfjord, Norway', 62.1049, 7.0941, 'nature'],
  ['Lake Tahoe Emerald Bay live cam', 'Emerald Bay, Lake Tahoe', 38.9545, -120.1062, 'nature'],
  ['Lake Geneva live cam', 'Lake Geneva, Switzerland', 46.4531, 6.5519, 'nature'],
  ['Hallstatt live cam', 'Hallstatt, Austria', 47.5622, 13.6493, 'nature'],
  ['Plitvice live cam', 'Plitvice Lakes, Croatia', 44.8654, 15.582, 'nature'],
  ['Victoria Falls live cam', 'Victoria Falls', -17.9243, 25.8572, 'nature'],
  ['Iguazu falls live cam', 'Iguazú Falls', -25.6953, -54.4367, 'nature'],
  ['Popocatepetl volcano live cam', 'Popocatépetl, Mexico', 19.0225, -98.6278, 'nature'],
  ['Fuego volcano live cam', 'Volcán de Fuego, Guatemala', 14.4747, -90.8806, 'nature'],
  ['Stromboli live cam', 'Stromboli, Italy', 38.7892, 15.2131, 'nature'],
  ['Aurora live cam Finland', 'Lapland, Finland', 68.0, 25.0, 'weather'],
  ['Abisko aurora live cam', 'Abisko, Sweden', 68.3495, 18.8312, 'weather'],
  ['Storm chasing live tornado cam', 'Oklahoma, US', 35.4676, -97.5164, 'weather'],
  // --- more cities ---
  ['San Antonio Riverwalk live cam', 'San Antonio, Texas', 29.4241, -98.4936, 'city'],
  ['Houston live cam', 'Houston, Texas', 29.7604, -95.3698, 'city'],
  ['Dallas live cam', 'Dallas, Texas', 32.7767, -96.797, 'city'],
  ['Phoenix live cam', 'Phoenix, Arizona', 33.4484, -112.074, 'city'],
  ['Portland Oregon live cam', 'Portland, Oregon', 45.5152, -122.6784, 'city'],
  ['Pittsburgh live cam', 'Pittsburgh, Pennsylvania', 40.4406, -79.9959, 'city'],
  ['Detroit live cam', 'Detroit, Michigan', 42.3314, -83.0458, 'city'],
  ['St Louis arch live cam', 'St. Louis, Missouri', 38.6247, -90.1848, 'city'],
  ['Kansas City live cam', 'Kansas City, Missouri', 39.0997, -94.5786, 'city'],
  ['Minneapolis live cam', 'Minneapolis, Minnesota', 44.9778, -93.265, 'city'],
  ['Savannah live cam', 'Savannah, Georgia', 32.0809, -81.0912, 'city'],
  ['Charleston live cam', 'Charleston, South Carolina', 32.7765, -79.9311, 'city'],
  ['Orlando live cam', 'Orlando, Florida', 28.5383, -81.3792, 'city'],
  ['Tampa live cam', 'Tampa, Florida', 27.9506, -82.4572, 'city'],
  ['Salt Lake City live cam', 'Salt Lake City, Utah', 40.7608, -111.891, 'city'],
  ['Ottawa live cam', 'Ottawa, Ontario', 45.4215, -75.6972, 'city'],
  ['Calgary live cam', 'Calgary, Alberta', 51.0447, -114.0719, 'city'],
  ['Guadalajara live cam', 'Guadalajara, Mexico', 20.6597, -103.3496, 'city'],
  ['Montevideo live cam', 'Montevideo, Uruguay', -34.9011, -56.1645, 'city'],
  ['Quito live cam', 'Quito, Ecuador', -0.1807, -78.4678, 'city'],
  ['Glasgow live cam', 'Glasgow, Scotland', 55.8642, -4.2518, 'city'],
  ['Belfast live cam', 'Belfast, Northern Ireland', 54.5973, -5.9301, 'city'],
  ['Cardiff live cam', 'Cardiff, Wales', 51.4816, -3.1791, 'city'],
  ['York live cam', 'York, England', 53.959, -1.0815, 'city'],
  ['Lyon live cam', 'Lyon, France', 45.764, 4.8357, 'city'],
  ['Strasbourg live cam', 'Strasbourg, France', 48.5734, 7.7521, 'city'],
  ['Rotterdam live cam', 'Rotterdam, Netherlands', 51.9244, 4.4777, 'city'],
  ['Antwerp live cam', 'Antwerp, Belgium', 51.2194, 4.4025, 'city'],
  ['Frankfurt live cam', 'Frankfurt, Germany', 50.1109, 8.6821, 'city'],
  ['Dresden live cam', 'Dresden, Germany', 51.0504, 13.7373, 'city'],
  ['Geneva live cam', 'Geneva, Switzerland', 46.2044, 6.1432, 'city'],
  ['Lucerne live cam', 'Lucerne, Switzerland', 47.0502, 8.3093, 'city'],
  ['Verona live cam', 'Verona, Italy', 45.4384, 10.9916, 'city'],
  ['Bologna live cam', 'Bologna, Italy', 44.4949, 11.3426, 'city'],
  ['Turin live cam', 'Turin, Italy', 45.0703, 7.6869, 'city'],
  ['Palermo live cam', 'Palermo, Italy', 38.1157, 13.3615, 'city'],
  ['Valencia live cam', 'Valencia, Spain', 39.4699, -0.3763, 'city'],
  ['Malaga live cam', 'Málaga, Spain', 36.7213, -4.4214, 'city'],
  ['Bratislava live cam', 'Bratislava, Slovakia', 48.1486, 17.1077, 'city'],
  ['Ljubljana live cam', 'Ljubljana, Slovenia', 46.0569, 14.5058, 'city'],
  ['Zagreb live cam', 'Zagreb, Croatia', 45.815, 15.9819, 'city'],
  ['Belgrade live cam', 'Belgrade, Serbia', 44.7866, 20.4489, 'city'],
  ['Sofia live cam', 'Sofia, Bulgaria', 42.6977, 23.3219, 'city'],
  ['Bucharest live cam', 'Bucharest, Romania', 44.4268, 26.1025, 'city'],
  ['Vilnius live cam', 'Vilnius, Lithuania', 54.6872, 25.2797, 'city'],
  ['Gdansk live cam', 'Gdańsk, Poland', 54.352, 18.6466, 'city'],
  ['Saint Petersburg live cam', 'Saint Petersburg, Russia', 59.9343, 30.3351, 'city'],
  ['Lviv live cam', 'Lviv, Ukraine', 49.8397, 24.0297, 'city'],
  ['Odesa live cam', 'Odesa, Ukraine', 46.4825, 30.7233, 'city'],
  ['Batumi live cam', 'Batumi, Georgia', 41.6168, 41.6367, 'beach'],
  ['Almaty live cam', 'Almaty, Kazakhstan', 43.222, 76.8512, 'city'],
  ['Beijing live cam', 'Beijing, China', 39.9042, 116.4074, 'city'],
  ['Chongqing live cam', 'Chongqing, China', 29.4316, 106.9123, 'city'],
  ['Kaohsiung live cam', 'Kaohsiung, Taiwan', 22.6273, 120.3014, 'city'],
  ['Kobe live camera', 'Kobe, Japan', 34.6901, 135.1955, 'city'],
  ['Kamakura live camera', 'Kamakura, Japan', 35.3192, 139.5467, 'city'],
  ['Hakodate live camera', 'Hakodate, Japan', 41.7687, 140.7288, 'city'],
  ['Nagasaki live camera', 'Nagasaki, Japan', 32.7503, 129.8779, 'city'],
  ['Incheon live cam', 'Incheon, South Korea', 37.4563, 126.7052, 'city'],
  ['Cebu live cam', 'Cebu, Philippines', 10.3157, 123.8854, 'city'],
  ['Phnom Penh live cam', 'Phnom Penh, Cambodia', 11.5564, 104.9282, 'city'],
  ['Yangon live cam', 'Yangon, Myanmar', 16.8409, 96.1735, 'city'],
  ['Dhaka live cam', 'Dhaka, Bangladesh', 23.8103, 90.4125, 'city'],
  ['Colombo live cam', 'Colombo, Sri Lanka', 6.9271, 79.8612, 'city'],
  ['Karachi live cam', 'Karachi, Pakistan', 24.8607, 67.0011, 'city'],
  ['Amman live cam', 'Amman, Jordan', 31.9454, 35.9284, 'city'],
  ['Beirut live cam', 'Beirut, Lebanon', 33.8938, 35.5018, 'city'],
  ['Riyadh live cam', 'Riyadh, Saudi Arabia', 24.7136, 46.6753, 'city'],
  ['Lagos live cam', 'Lagos, Nigeria', 6.5244, 3.3792, 'city'],
  ['Accra live cam', 'Accra, Ghana', 5.6037, -0.187, 'city'],
  ['Addis Ababa live cam', 'Addis Ababa, Ethiopia', 9.03, 38.74, 'city'],
  ['Johannesburg live cam', 'Johannesburg, South Africa', -26.2041, 28.0473, 'city'],
  ['Tunis live cam', 'Tunis, Tunisia', 36.8065, 10.1815, 'city'],
  ['Adelaide live cam', 'Adelaide, Australia', -34.9285, 138.6007, 'city'],
  ['Hobart live cam', 'Hobart, Australia', -42.8821, 147.3272, 'city'],
  ['Darwin live cam', 'Darwin, Australia', -12.4634, 130.8456, 'city'],
  ['Christchurch live cam', 'Christchurch, New Zealand', -43.532, 172.6306, 'city'],
];
const PER_PLACE = 4; // up to this many different streams per place

// Streams that are great but not where their search query pointed: pin them to their real location.
export const FIXES = {
  hz6_oM2q0gU: ['Prairie du Chien, Wisconsin', 43.0517, -91.1412, 'transport'],
  'xwuuvc86-CI': ['Puerto Vallarta, Mexico', 20.6015, -105.237, 'beach'],
  qhXQgd4YKcw: ['Little Havana, Miami', 25.7655, -80.219, 'city'],
  '-q7PIgn8YLY': ['Lisbon Falls, South Africa', -24.8497, 30.8583, 'nature'],
  Jv_2vPCbZUo: ['Chaweng, Koh Samui', 9.531, 100.062, 'beach'],
  '6hPWq2IG08M': ['Port of Helsinki, Finland', 60.153, 24.915, 'transport'],
  VhGdKCs5KIA: ['Saint Petersburg, Russia', 59.9343, 30.3351, 'city'],
  O52zDyxg5QI: ['Fairbanks, Alaska', 64.8378, -147.7164, 'weather'],
  'B4-L2nfGcuE': ['Big Bear Lake, California', 34.2439, -116.9114, 'nature'],
  yLHx5DV9rB8: ['Tohoku Shinkansen, Japan', 37.75, 140.47, 'transport'],
  '5azcjrgRNMY': ['Gold Coast Airport, Australia', -28.1644, 153.5047, 'transport'],
  i3kmj2b8zkA: ['Budapest Zoo, Hungary', 47.5186, 19.0784, 'nature'],
  Ejqdvz7EvyE: ['Campi Flegrei, Naples', 40.827, 14.139, 'nature'],
  WtoxxHADnGk: ['El Valle de Antón, Panama', 8.65, -80.13, 'nature'],
};

const BAD =/walk|散歩|driving|drive |dashcam|radio|lofi|lo-fi|music|news|replay|highlights|recorded|timelapse|time-lapse|game|gta|minecraft/i;
const GOOD = /cam|camera|カメラ|webcam|live view|24\/7|earth view|planespotting/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));
// The title must mention the place (e.g. "Aspen" must not resolve to a Telluride stream).
const STOP = new Set(['live', 'cam', 'camera', 'city', 'beach', 'airport', 'intl', 'region', 'the', 'new', 'mount', 'harbour', 'harbor', 'square', 'street', 'crossing', 'bridge', 'falls', 'tower', 'grand', 'canal', 'desert', 'earth', 'orbit']);
function placeWords(q, place) {
  const words = place.split(',')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/);
  return [...new Set(words.filter(w => w.length > 3 && !STOP.has(w)))];
}
const fold = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

async function search(q) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try { return await searchOnce(q); }
    catch (e) { if (attempt === 4) throw e; await sleep(4000 * attempt); }
  }
}
async function searchOnce(q) {
  const res = await fetch('https://www.youtube.com/results?search_query=' + encodeURIComponent(q) + '&sp=EgJAAQ%253D%253D', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' },
  });
  const html = await res.text();
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) return [];
  const vids = [];
  JSON.stringify(JSON.parse(m[1]), (k, v) => { if (k === 'videoRenderer') vids.push(v); return v; });
  return vids.map(v => ({
    id: v.videoId,
    title: (v.title?.runs || []).map(r => r.text).join(''),
    channel: v.ownerText?.runs?.[0]?.text || '',
    live: (v.badges || []).some(b => /LIVE/i.test(b.metadataBadgeRenderer?.label || '')) || /watching/.test(JSON.stringify(v.viewCountText || '')),
    watching: parseInt((JSON.stringify(v.viewCountText || '').match(/([\d,]+) watching/) || [, '0'])[1].replace(/,/g, ''), 10),
  }));
}
async function embeddable(id) {
  const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`, { headers: { 'User-Agent': UA } });
  return r.ok; // 401 = embedding disabled, 404 = gone
}

// ---------- which places to search ----------
// Default: the hand-picked PLACES plus every big world city (scripts/data/world-cities.json, from Natural Earth)
// that isn't already within 25 km of one of them. `--cities` searches only cities not yet covered by the current
// youtube.json and ADDS its finds to that file instead of replacing it.
const CITIES_ONLY = process.argv.includes('--cities');
const cities = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), 'data', 'world-cities.json'), 'utf8'));
let prevList = [];
try { prevList = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
const kmBetween = (a1, o1, a2, o2) => {
  const r = Math.PI / 180, dA = (a2 - a1) * r, dO = (o2 - o1) * r;
  const h = Math.sin(dA / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const covered = CITIES_ONLY ? prevList.map(p => [p.la, p.lo]) : PLACES.map(p => [p[2], p[3]]);
const cityPlaces = cities
  .filter(([, , la, lo]) => !covered.some(([a, o]) => kmBetween(a, o, la, lo) < 25))
  .map(([name, country, la, lo]) => [`${name} live cam`, `${name}, ${country}`, la, lo, 'city', 3]);
const SEARCH = CITIES_ONLY ? cityPlaces : [...PLACES, ...cityPlaces];
console.log(`Searching ${SEARCH.length} places${CITIES_ONLY ? ' (new cities only, appending)' : ''}…`);

const picked = [];
const used = new Set(CITIES_ONLY ? prevList.map(p => p.id) : []);
// Sequential with a pause: YouTube starts refusing connections if we search in parallel.
for (const [q, place, la, lo, c, perPlace = PER_PLACE] of SEARCH) {
  try {
    const words = placeWords(q, place);
    const results = (await search(q)).filter(v => v.live && !BAD.test(v.title) && !used.has(v.id) && words.some(w => fold(v.title + ' ' + v.channel).includes(w)));
    results.sort((a, b) => (GOOD.test(b.title) - GOOD.test(a.title)));
    let got = 0;
    for (const v of results.slice(0, 6)) {
      if (got >= perPlace) break;
      if (!(await embeddable(v.id))) continue;
      used.add(v.id);
      picked.push({ id: v.id, title: v.title.slice(0, 120), channel: v.channel, place, la, lo, c });
      console.log(`✔ ${place.padEnd(32)} ${v.id}  ${v.title.slice(0, 70)}`);
      got++;
    }
    if (!got) console.log(`✘ ${place.padEnd(32)} no matching embeddable live cam`);
  } catch (e) { console.log(`✘ ${place.padEnd(32)} ${e.message}`); }
  await sleep(1500);
}
for (const p of picked) if (FIXES[p.id]) [p.place, p.la, p.lo, p.c] = FIXES[p.id];
let result = picked;
if (CITIES_ONLY) result = prevList.concat(picked);
// If YouTube throttled us (common on cloud CI runners), keep the previous list instead of shrinking it.
else if (picked.length < prevList.length * 0.6) { console.log(`\nOnly ${picked.length} found vs ${prevList.length} before: keeping the previous list.`); process.exit(0); }
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(result, null, 1));
console.log(`\n${picked.length} new streams from ${SEARCH.length} places; ${result.length} total → ${OUT}`);
