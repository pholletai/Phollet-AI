import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, SafeAreaView, KeyboardAvoidingView, Platform, Modal } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import AppHeader from './components/AppHeader'; // ✅ កែផ្លូវ Import ត្រូវចំកន្លែងហើយ

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', text: "សួស្តី! ខ្ញុំជា Phollet AI 🧠 តើខ្ញុំអាចជួយអ្វីបានខ្លះ?", sender: 'ai' }
  ]);
  const [inputText, setInputText] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPaywallOpen, setIsPaywallOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
// បង្កើត State រាប់ចំនួនសារដែលបានប្រើ (Free 15 ដង/ថ្ងៃ)
const [usageCount, setUsageCount] = useState(0);

// បន្ទាត់ទី ២៥
const subscriptionPlans = [
   { id: 'trial', name: 'សាកល្បង', price: '$0.00', duration: '១៥ ថ្ងៃ' },
   { id: 'basic', name: 'មូលដ្ឋាន', price: '$6.99', duration: '១ ខែ' },
   { id: 'standard', name: 'ស្តង់ដារ', price: '$12.99', duration: '៣ ខែ' },
   { id: 'premium', name: 'ពិសេស', price: '$19.99', duration: '១ ឆ្នាំ' },
];

  // ... កូដរបស់បងនៅដដែល
  const handleSend = async () => {
    if (inputText.trim() === '' || isLoading) return;

    // 🔒 បើប្រើគ្រប់ ១៥ ដង វានឹងលោតផ្ទាំងគិតលុយភ្លាម
    if (usageCount >= 15) {
      setIsPaywallOpen(true);
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      text: inputText,
      sender: 'user',
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);
    setUsageCount((prev) => prev + 1); // ថែមចំនួនប្រើប្រាស់

    setTimeout(() => {
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: "នេះជាចម្លើយតបសាកល្បងពីប្រព័ន្ធស្នូល Phollet AI របស់បង!",
        sender: 'ai',
      };
      setMessages((prev) => [...prev, aiMessage]);
      setIsLoading(false);
    }, 1200);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      {/* ✅ ហៅរបារ Header ឡូហ្គោ PAI រួមទាំងប៊ូតុងបញ្ជា */}
      <AppHeader 
        onOpenSidebar={() => setIsSidebarOpen(true)} 
        onOpenSettings={() => setIsSettingsOpen(true)} 
      />

      {/* 💬 ផ្ទាំងប្រវត្តិឆាត Sidebar ខាងស្ដាំ */}
      {isSidebarOpen && (
        <View style={styles.sidebar}>
          <View style={styles.sidebarHeader}>
            <Text style={styles.sidebarTitle}>ប្រវត្តិការជជែក (History)</Text>
            <TouchableOpacity onPress={() => setIsSidebarOpen(false)}>
              <Ionicons name="close" size={24} color="#F8FAFC" />
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.sidebarItem}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color="#94A3B8" />
            <Text style={{ color: '#E2E8F0', marginLeft: 8 }}>ការសន្ទនាទី ១</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ⚙️ ផ្ទាំងការកំណត់ Settings ខាងឆ្វេង */}
      {isSettingsOpen && (
        <View style={[styles.sidebar, { left: 0, right: undefined }]}>
          <View style={styles.sidebarHeader}>
            <Text style={styles.sidebarTitle}>ការកំណត់ (Settings)</Text>
            <TouchableOpacity onPress={() => setIsSettingsOpen(false)}>
              <Ionicons name="close" size={24} color="#F8FAFC" />
            </TouchableOpacity>
          </View>
          <Text style={{ color: '#94A3B8', fontSize: 14 }}>ជំនាន់កម្មវិធី៖ v1.0.0 (PAI)</Text>
          <TouchableOpacity style={[styles.sidebarItem, { marginTop: 20, backgroundColor: '#334155' }]} onPress={() => setIsPaywallOpen(true)}>
            <Ionicons name="star" size={18} color="#F59E0B" />
            <Text style={{ color: '#F8FAFC', marginLeft: 8, fontWeight: 'bold' }}>Upgrade to Premium</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ផ្ទាំងបង្ហាញសារជជែក */}
      <ScrollView style={styles.chatContainer}>
        {messages.map((msg) => (
          <View key={msg.id} style={[styles.messageBubble, msg.sender === 'user' ? styles.userBubble : styles.aiBubble]}>
            <Text style={styles.messageText}>{msg.text}</Text>
          </View>
        ))}
        {isLoading && <Text style={{ color: '#64748B', marginLeft: 16 }}>PAI កំពុងគិត...</Text>}
      </ScrollView>

      {/* 🎤 📸 ផ្ទាំង Input Bar ខាងក្រោមដែលមានមុខងារគ្រប់គ្រាន់ */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.inputContainer}>
          
          {/* ប៊ូតុង រូបភាព 📸 */}
          <TouchableOpacity style={styles.mediaButton}>
            <Ionicons name="image-outline" size={22} color="#94A3B8" />
          </TouchableOpacity>

          {/* ប៊ូតុង សំឡេង 🎤 */}
          <TouchableOpacity style={styles.mediaButton}>
            <Ionicons name="mic-outline" size={22} color="#94A3B8" />
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            placeholder={`សួរសំណួរទៅកាន់ PAI... (${usageCount}/15)`}
            placeholderTextColor="#64748B"
            value={inputText}
            onChangeText={setInputText}
          />

          <TouchableOpacity style={styles.sendButton} onPress={handleSend} disabled={isLoading}>
            <Ionicons name="arrow-up" size={20} color="#F8FAFC" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* 💰 ផ្ទាំងគិតលុយ Subscription Modal Popup ($6.99, $14.99, $19.99) */}
      <Modal visible={isPaywallOpen} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.paywallCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.paywallTitle}>🚀 ដំឡើងទៅកម្រិត Premium</Text>
              <TouchableOpacity onPress={() => setIsPaywallOpen(false)}>
                <Ionicons name="close" size={24} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            <Text style={styles.paywallSub}>បងបានប្រើប្រាស់អស់ចំនួនកំណត់ Free 15 ដងហើយ។ សូមជ្រើសរើសកញ្ចប់៖</Text>
             <Text style={styles.paywallSub}>បងបានប្រើប្រាស់អស់ចំនួនកំណត់...</Text>
            {/* កញ្ចប់ទី ១ */}
            
            <TouchableOpacity style={styles.tierButton}>
              <View>
                <Text style={styles.tierName}>🎓 កញ្ចប់សិស្ស (Student Pro)</Text>
                <Text style={styles.tierDesc}>ប្រើប្រាស់ AI កម្រិតខ្ពស់ ល្បឿនលឿន</Text>
              </View>
              <Text style={styles.tierPrice}>$6.99/ខែ</Text>
            </TouchableOpacity>

            {/* កញ្ចប់ទី ២ */}
            <TouchableOpacity style={[styles.tierButton, { borderColor: '#475569', backgroundColor: '#1E293B' }]}>
              <View>
                <Text style={[styles.tierName, { color: '#F59E0B' }]}>🔥 ពេញនិយម (Creator Pro)</Text>
                <Text style={styles.tierDesc}>ថែមមុខងារ 🎤 Voice និង 📸 Image Bot</Text>
              </View>
              <Text style={styles.tierPrice}>$14.99/ខែ</Text>
            </TouchableOpacity>

            {/* កញ្ចប់ទី ៣ */}
            <TouchableOpacity style={styles.tierButton}>
              <View>
                <Text style={styles.tierName}>🏢 សម្រាប់អាជីវកម្ម (Business)</Text>
                <Text style={styles.tierDesc}>គាំទ្រ API ផ្ទាល់ខ្លួន និងការឆ្លើយតបអតិថិជន</Text>
              </View>
              <Text style={styles.tierPrice}>$19.99/ខែ</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  chatContainer: { flex: 1, padding: 16 },
  messageBubble: { padding: 12, borderRadius: 16, marginVertical: 6, maxWidth: '80%' },
  userBubble: { backgroundColor: '#1E293B', alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  aiBubble: { backgroundColor: '#334155', alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  messageText: { color: '#F8FAFC', fontSize: 15 },
  inputContainer: { flexDirection: 'row', padding: 16, backgroundColor: '#0F172A', borderTopWidth: 1, borderTopColor: '#1E293B', alignItems: 'center', gap: 8 },
  mediaButton: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#1E293B', alignItems: 'center',   justifyContent: 'center' },
  input: { flex: 1, backgroundColor: '#1E293B', color: '#F8FAFC', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, fontSize: 15 },
  sendButton: { backgroundColor: '#334155', width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sidebar: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 280, backgroundColor: '#0F172A', zIndex: 100, padding: 16, borderLeftWidth: 1, borderLeftColor: '#1E293B', borderRightWidth: 1, borderRightColor: '#1E293B', paddingTop: 60 },
  sidebarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  sidebarTitle: { color: '#F8FAFC', fontSize: 16, fontWeight: 'bold' },
  sidebarItem: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#1E293B', borderRadius: 8, marginBottom: 10 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 },
  paywallCard: { backgroundColor: '#0F172A', borderRadius: 20, padding: 24, borderWidth: 1, borderColor: '#1E293B' },
  paywallTitle: { color: '#F8FAFC', fontSize: 20, fontWeight: 'bold' },
  paywallSub: { color: '#94A3B8', fontSize: 14, marginVertical: 12, lineHeight: 20 },
  tierButton: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#1E293B', borderRadius: 14, marginVertical: 6, borderWidth: 1, borderColor: '#334155' },
  tierName: { color: '#F8FAFC', fontSize: 15, fontWeight: '600' },
  tierDesc: { color: '#94A3B8', fontSize: 12, marginTop: 2 },
  tierPrice: { color: '#F8FAFC', fontSize: 16, fontWeight: 'bold' }
});