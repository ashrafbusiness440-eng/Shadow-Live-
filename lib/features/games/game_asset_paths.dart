abstract final class GameAssetPaths {
  static const greedyRoot = 'assets/images/games/greedy_cat';
  static const witchRoot = 'assets/images/games/witch';
  static const slotRoot = 'assets/images/games/slot';

  static const greedyCover = '$greedyRoot/greedy_cat_cover.webp';
  static const greedyMascot = '$greedyRoot/cat_mascot.webp';
  static const greedySalad = '$greedyRoot/salad.webp';
  static const greedyPizza = '$greedyRoot/pizza.webp';

  static const witchCover = '$witchRoot/witch_cover.webp';
  static const witchCharacter = '$witchRoot/witch_character.webp';
  static const witchNormalBackground = '$witchRoot/normal_background.webp';
  static const witchAdvancedBackground = '$witchRoot/advanced_background.webp';

  static const slotCover = '$slotRoot/slot_cover.webp';
  static const slotBackground = '$slotRoot/slot_background.webp';
  static const slotJackpot = '$slotRoot/jackpot.webp';

  static const greedyChoices = <String, String>{
    'pepper5': '$greedyRoot/pepper.webp',
    'tomato5': '$greedyRoot/tomato.webp',
    'cabbage5': '$greedyRoot/cabbage.webp',
    'carrot5': '$greedyRoot/carrot.webp',
    'chicken10': '$greedyRoot/chicken.webp',
    'fish15': '$greedyRoot/fish.webp',
    'steak25': '$greedyRoot/steak.webp',
    'shell45': '$greedyRoot/shell.webp',
  };

  static const witchSymbols = <String, String>{
    'moon': '$witchRoot/moon.webp',
    'mirror': '$witchRoot/mirror.webp',
    'potion': '$witchRoot/potion.webp',
    'orb': '$witchRoot/orb.webp',
    'owl': '$witchRoot/owl.webp',
    'book': '$witchRoot/book.webp',
  };

  static const slotSymbols = <String, String>{
    'crown': '$slotRoot/crown.webp',
    'diamond': '$slotRoot/diamond.webp',
    'star': '$slotRoot/star.webp',
    'mic': '$slotRoot/mic.webp',
    'moon': '$slotRoot/moon.webp',
    'fire': '$slotRoot/fire.webp',
  };

  static String coverFor(String gameId) {
    switch (gameId) {
      case 'greedy_cat':
        return greedyCover;
      case 'witch':
        return witchCover;
      case 'slot':
        return slotCover;
      default:
        return greedyCover;
    }
  }

  static String? backgroundFor(String gameId, String mode) {
    if (gameId == 'witch') {
      return mode == 'advanced'
          ? witchAdvancedBackground
          : witchNormalBackground;
    }
    if (gameId == 'slot') return slotBackground;
    return null;
  }
}
