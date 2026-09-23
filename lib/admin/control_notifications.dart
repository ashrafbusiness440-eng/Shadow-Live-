abstract final class NotificationPolicy {
 static const criticalCategories={'finance','security'};
 static const categories={'social','rooms','gifts','missions','events','campaigns','finance','security'};
 static bool canFullyDisable(String category)=>!criticalCategories.contains(category);
}
