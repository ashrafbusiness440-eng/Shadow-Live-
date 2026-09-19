abstract final class RankingPolicy {
 static int popularityXpForReceivedCoins(int coins)=>coins~/100;
 static int wealthXpForSpentCoins(int coins)=>coins~/100;
 static const maxPopularityLevel=100, maxWealthLevel=150;
 static const periods={'daily','weekly','monthly'};
 static const boards={'supporters','stars','popularity','wealth','agencies'};
}
