enum ControlLoadState { idle, loading, ready, error }
class ControlDashboardState {
 const ControlDashboardState({this.state=ControlLoadState.idle,this.message});
 final ControlLoadState state; final String? message;
 bool get busy=>state==ControlLoadState.loading;
 bool get failed=>state==ControlLoadState.error;
}
