import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { reportError } from '../safe';

// Catches render errors so a bad piece of data can never close the app.
// `compact` is used around individual rows/screens; the full-screen variant wraps the whole app.
export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error) { reportError(error, this.props.name || 'boundary'); }

  reset = () => { this.setState({ error: null }); if (this.props.onReset) this.props.onReset(); };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.compact) return null; // a broken row just disappears
    return (
      <View style={{ flex: 1, backgroundColor: '#212836', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: '#fff', fontSize: 20, marginBottom: 8, fontWeight: '700' }}>Something went wrong</Text>
        <Text style={{ color: '#ffffffaa', textAlign: 'center', marginBottom: 16 }}>HelloCat hit an unexpected problem, but it is still running.</Text>
        <ScrollView style={{ maxHeight: 120, alignSelf: 'stretch', marginBottom: 16 }}>
          <Text selectable style={{ color: '#ffffff66', fontSize: 11 }}>{String(error && error.message)}</Text>
        </ScrollView>
        <TouchableOpacity onPress={this.reset} style={{ backgroundColor: '#5d8ffc', paddingVertical: 12, paddingHorizontal: 28, borderRadius: 8 }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}
