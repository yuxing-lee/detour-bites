import './dom.js';
import './mealTheme.js';
import './eatenList.js';
import './googleMaps.js';
import './results.js';
import './discover.js';
import './search.js';
import './shoppingList.js';
import { initAppMode } from './appMode.js';

// 所有模組（包含模式切換的監聽）都載入之後，才決定一開始停在找吃的還是採買清單
initAppMode();
