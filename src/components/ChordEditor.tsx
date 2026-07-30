import React, { useState, useEffect } from 'react';
import { X, Globe, Youtube, Music, Save, Loader2, FileText, Sparkles, Plus, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Chord } from '../types';
import axios from 'axios';
import PDFImporter from './PDFImporter';

interface ChordEditorProps {
  chord: Chord | null;
  onClose: () => void;
  bookId?: string | null;
  profile: any;
}

export default function ChordEditor({ chord, onClose, bookId, profile }: ChordEditorProps) {
  const [loading, setLoading] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [searchingYoutube, setSearchingYoutube] = useState(false);
  const [convertingAI, setConvertingAI] = useState(false);
  const [showPDFImporter, setShowPDFImporter] = useState(false);
  const [categories, setCategories] = useState<string[]>(['Missa', 'Laudes', 'Oração', 'Outros']);
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [categorySearch, setCategorySearch] = useState('');
  
  const [extractingMetadata, setExtractingMetadata] = useState(false);
  
  const [form, setForm] = useState({
    title: chord?.title || '',
    artist: chord?.artist || '',
    categories: chord?.category ? chord.category.split(',').map(c => c.trim()) : ['Missa'],
    content: chord?.content || '',
    original_key: chord?.originalKey || chord?.original_key || 'C',
    youtube_url: chord?.youtubeUrl || chord?.youtube_url || '',
    audio_url: chord?.audio_url || '',
    attachment_url: chord?.attachment_url || '',
  });

  const [attachments, setAttachments] = useState<{ id?: string; name: string; url: string; type: 'audio' | 'text'; isNew?: boolean; file?: File }[]>(() => {
    if (chord && Array.isArray(chord.attachments)) {
      return chord.attachments;
    }
    const initial: { name: string; url: string; type: 'audio' | 'text' }[] = [];
    if (chord?.audio_url) {
      let name = 'Áudio Anterior';
      try {
        const decoded = decodeURIComponent(chord.audio_url);
        const parts = decoded.split('/');
        const lastPart = parts[parts.length - 1];
        name = lastPart.includes('_') ? lastPart.split('_').slice(1).join('_') : lastPart;
      } catch (e) {}
      initial.push({ name, url: chord.audio_url, type: 'audio' });
    }
    if (chord?.attachment_url) {
      let name = 'Anexo Anterior';
      try {
        const decoded = decodeURIComponent(chord.attachment_url);
        const parts = decoded.split('/');
        const lastPart = parts[parts.length - 1];
        name = lastPart.includes('_') ? lastPart.split('_').slice(1).join('_') : lastPart;
      } catch (e) {}
      initial.push({ name, url: chord.attachment_url, type: 'text' });
    }
    return initial;
  });

  const [uploadProgress, setUploadProgress] = useState<{ [key: string]: number }>({});

  const handleAddAttachment = (type: 'audio' | 'text', file: File) => {
    const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    setAttachments(prev => [
      ...prev,
      {
        name: nameWithoutExt,
        url: '',
        type,
        isNew: true,
        file
      }
    ]);
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleRenameAttachment = (index: number, newName: string) => {
    setAttachments(prev => prev.map((item, idx) => idx === index ? { ...item, name: newName } : item));
  };

  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const { data } = await supabase
        .from('chords')
        .select('category');
      
      if (data) {
        const allCats = data.flatMap((item: any) => 
          item.category ? item.category.split(',').map((c: string) => c.trim()) : []
        );
        const unique = Array.from(new Set(allCats)).filter((c): c is string => typeof c === 'string' && c.length > 0);
        const base = ['Missa', 'Laudes', 'Oração', 'Outros'];
        const combined = Array.from(new Set([...base, ...unique])).filter(Boolean);
        setCategories(combined);
      }
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  };

  const extractMetadataWithAI = async () => {
    if (!form.content.trim()) {
      setNotification({ message: 'Cole o conteúdo da cifra primeiro.', type: 'error' });
      return;
    }
    
    setExtractingMetadata(true);
    
    try {
      const prompt = `Analise o texto abaixo e extraia:
      1. Título da Música
      2. Nome do Artista
      3. Tom (Key) - Ex: C, G, Am, Eb
      
      Retorne APENAS um JSON no formato:
      {"title": "...", "artist": "...", "key": "..."}
      
      TEXTO:
      ${form.content.substring(0, 2000)}`;

      const response = await fetch('/api/ai-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          responseMimeType: 'application/json'
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || 'Erro no proxy de IA');
      }
      const dataJson = await response.json();
      const text = dataJson.text;

      if (text) {
        const data = JSON.parse(text);
        setForm(prev => ({
          ...prev,
          title: data.title || prev.title,
          artist: data.artist || prev.artist,
          original_key: data.key || prev.original_key
        }));
        setNotification({ message: 'Informações extraídas com sucesso!', type: 'success' });
        
        if (data.title && data.artist) {
          searchYoutube(data.title, data.artist);
        }
      }
    } catch (error) {
      console.error('AI Metadata Extraction failed:', error);
      setNotification({ message: 'Não foi possível extrair as informações automaticamente.', type: 'error' });
    } finally {
      setExtractingMetadata(false);
    }
  };

  const convertToChordProWithAI = async () => {
    if (!form.content.trim()) return;
    
    setConvertingAI(true);
    
    try {
      const prompt = `Você é um Analista Musical de ELITE especializado em arquitetura ChordPro. 
      Sua missão é converter a cifra abaixo para o formato ChordPro (.chopro) com fidelidade absoluta ao tempo e à harmonia.

      CONCEITOS FUNDAMENTAIS:
      1. ALINHAMENTO VERTICAL (O MAIS IMPORTANTE): Se um acorde está sobre a letra 'a' da palavra 'Amor', ele deve ficar '[D]Amor'.
      2. LINHAS INSTRUMENTAIS: Linhas como Intro, Solo, Instrumental que não possuem letra abaixo devem ter seus acordes envolvidos por [] e manter um espaçamento largo (mínimo 8 espaços) para facilitar a leitura.
      3. TABLATURAS: Remova linhas de tablaturas puras (que usam ---, |---, etc.) para manter o foco nos acordes.

      EXEMPLO DE CONVERSÃO (INPUT):
      Intro: G  D/F#  Em  C
      
          G          D/F#
      O Senhor é o meu pastor
      Em          C
      Nada me faltará

      EXEMPLO DE CONVERSÃO (OUTPUT):
      Intro: [G]        [D/F#]        [Em]        [C]

      [G]O Senhor é o [D/F#]meu pastor
      [Em]Nada me fal[C]tará

      DIFERENCIAÇÃO DE LINHAS:
      - LINHAS DE ACORDES: Compostas por letras A-G, números, #, b, e extensões (m, 7, sus4, add9).
      - LINHAS DE LETRA: Contêm artigos, preposições e palavras comuns em português.

      RETORNO:
      Retorne APENAS o conteúdo convertido final. Sem explicações ou markdown.

      CIFRA PARA CONVERSÃO:
      ${form.content}`;

      const response = await fetch('/api/ai-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          // model: 'gemini-3-flash-preview' - Removed to use server default
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || 'Erro no proxy de IA');
      }
      const dataJson = await response.json();
      const text = dataJson.text;
      
      if (text) {
        const cleanedText = text.replace(/```chordpro|```/g, '').trim();
        setForm(prev => ({ ...prev, content: cleanedText }));
      }
    } catch (error) {
      console.error('AI Conversion failed:', error);
      setForm(prev => ({ ...prev, content: convertToChordPro(prev.content) }));
    } finally {
      setConvertingAI(false);
    }
  };

  const convertToChordPro = (text: string) => {
    const lines = text.split('\n');
    const result: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const currentLine = lines[i];
      
      // Função para verificar se uma linha é de acordes
      const isChordLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        
        const lowercase = trimmed.toLowerCase();
        
        // Se começar com uma seção conhecida, é quase certamente uma linha instrumental/acordes
        const isKnownSection = /^(intro|solo|ponte|final|vocalize|inst|passagem|instrumental|dedilhado|ritmo):/i.test(lowercase);
        if (isKnownSection) return true;

        // Palavras comuns em português que indicam que a linha é LETRA
        const lyricWords = /\b(?:que|com|para|se|os|as|dos|das|um|uma|é|da|do|de|em|no|na|eu|você|meu|seu|esta|este|isso|aquilo|quem|quando|onde|como|por|mas|nem|ou|então|pois|sim|não|mais|muito|tudo|nada|fazer|ter|ser|vir|ir|estar|vou|vai|vão|nos|nós|vos|vós|eles|elas|me|te|se|lhe|nos|vos|lhes|meu|minha|teu|tua|seu|sua|nosso|vossa|este|esta|isso|esse|essa|isso|aquele|aquela|aquilo)\b/i;
        
        if (lyricWords.test(lowercase)) {
          // Exceção: Se a linha começar com Intro/Solo mas tiver uma palavra de letra (raro, mas possível), priorizamos instrumental se houver muitos acordes
          if (isKnownSection) {
            const tokens = trimmed.split(/\s+/);
            const chordRegex = /^[A-G](?:[m#b7M9]|sus|add|dim|aug|maj|alt|\d|\/|[A-G][#b]?|\+|\(|\)|\-)*$/i;
            const chords = tokens.filter(t => chordRegex.test(t));
            if (chords.length >= 2) return true;
          }
          return false;
        }

        const tokens = trimmed.split(/\s+/);
        // Filtramos tokens que são seções ou braquetes explicativos
        const contentTokens = tokens.filter(t => !/^(Intro|Solo|Ponte|Final|Vocalize|Inst|Passagem|Instrumental|Refrão|Coro):?$/i.test(t));
        
        if (contentTokens.length === 0) return false; // Linha vazia ou só tag de seção não-instrumental

        let chordCount = 0;
        let otherCount = 0;

        contentTokens.forEach(token => {
          const chordRegex = /^[A-G](?:[m#b7M9]|sus|add|dim|aug|maj|alt|\d|\/|[A-G][#b]?|\+|\(|\)|\-)*$/i;
          const isChord = chordRegex.test(token);
          const isSpecial = /^\(.*\)$/.test(token) || token === '|' || token === '||' || /^[0-9]+x$/i.test(token) || /^[\|\-d]+$/.test(token);
          
          if (isChord) chordCount++;
          else if (isSpecial) chordCount++; 
          else otherCount++;
        });

        return chordCount > otherCount || (chordCount > 0 && otherCount === 0);
      };

      const nextLine = lines[i + 1] || '';

      if (isChordLine(currentLine)) {
        // Se a próxima linha NÃO é de acordes e NÃO está vazia, mesclamos
        if (nextLine && !isChordLine(nextLine) && nextLine.trim()) {
          const chords: { chord: string, pos: number }[] = [];
          const regex = /[A-G](?:[m#b7M9]|sus|add|dim|aug|maj|alt|\d|\/|[A-G][#b]?|\+|\(|\)|\-)*/g;
          let match;

          while ((match = regex.exec(currentLine)) !== null) {
            const val = match[0].trim();
            if (val && /[A-G]/.test(val)) {
              chords.push({ chord: val, pos: match.index });
            }
          }

          const sortedChords = [...chords].sort((a, b) => b.pos - a.pos);
          let mergedLine = nextLine;
          
          for (const c of sortedChords) {
            if (c.pos > mergedLine.length) {
              const padding = ' '.repeat(c.pos - mergedLine.length);
              mergedLine = mergedLine + padding + `[${c.chord}]`;
            } else {
              const prefix = mergedLine.substring(0, c.pos);
              const suffix = mergedLine.substring(c.pos);
              mergedLine = prefix + `[${c.chord}]` + suffix;
            }
          }
          
          result.push(mergedLine);
          i++; 
        } else {
          // Instrumental (Intro, Solo, etc.) - Preserva e melhora espaçamento original
          const parts = currentLine.split(/(\s+)/);
          let converted = "";
          
          for (const part of parts) {
            const chordRegex = /^[A-G](?:[m#b7M9]|sus|add|dim|aug|maj|alt|\d|\/|[A-G][#b]?|\+|\(|\)|\-)*$/i;
            const isSection = /^(Intro|Solo|Ponte|Final|Vocalize|Inst|Passagem|Instrumental|Refrão|Coro):?$/i.test(part);
            const isSpecial = /^\(.*\)$/.test(part) || part === '|' || part === '||' || /^[0-9]+x$/i.test(part) || /^[\|\-d]+$/.test(part);
            
            if (part.trim() && !isSection && (chordRegex.test(part) || isSpecial)) {
              converted += `[${part}]`;
            } else if (!part.trim() && part.length > 0) {
              // Aumenta o espaçamento original para clareza, mantendo a proporção
              const originalLength = part.length;
              const newLength = Math.max(originalLength * 1.5, 8);
              converted += ' '.repeat(Math.floor(newLength));
            } else {
              converted += part;
            }
          }
          result.push(converted);
        }
      } else {
        result.push(currentLine);
      }
    }
    
    return result.join('\n');
  };

  // Categorias litúrgicas "genéricas" que NÃO ajudam a identificar a música
  // (toda cifra tem uma dessas) — o que sobra depois de tirá-las da lista de
  // categorias normalmente é o nome do álbum/coletânea/ministério (ver regra
  // 6b do prompt de importação de PDF), que é muito mais útil pra achar o
  // vídeo certo do que "artista: Desconhecido".
  const GENERIC_CATEGORIES = new Set([
    'missa', 'louvor', 'adoração', 'oração', 'ação de graças', 'outros'
  ]);

  const searchYoutube = async (title?: string, artist?: string) => {
    const rawTitle = title || form.title;
    // Alguns títulos vindos de importação antiga têm um trecho de letra colado
    // entre parênteses/traço (ex.: "Ossos Secos (Espírito Santo Desce)") — isso
    // some do NOME da música mas não deve ir pra busca do vídeo, senão vira
    // ruído que desvia o resultado do canal/vídeo oficial.
    const t = (rawTitle || '').split(/[(\-–—]/)[0].trim() || rawTitle;
    const a = artist || form.artist;
    if (!t) return;

    setSearchingYoutube(true);
    try {
      const queryParts = [t];

      // "Desconhecido" (valor padrão quando a IA/importação não identifica o
      // artista) não ajuda em nada a busca — pelo contrário, é uma palavra a
      // mais competindo com o nome real da música. Só inclui o artista se for
      // um valor de verdade.
      if (a && a.trim() && a.trim().toLowerCase() !== 'desconhecido') {
        queryParts.push(a.trim());
      }

      // Nome do álbum/coletânea: qualquer categoria que não seja uma das
      // litúrgicas genéricas (ex.: "Cantai a Deus 2020", "Comunidade Shalom").
      const albumCategories = form.categories.filter(
        c => c && !GENERIC_CATEGORIES.has(c.trim().toLowerCase())
      );
      queryParts.push(...albumCategories);

      // Nome do arquivo PDF de origem, se esta cifra veio de uma importação —
      // costuma trazer justamente o nome do hinário/coletânea/ministério
      // impresso no arquivo (ex.: "Cantai_a_Deus_2020_Shalom.pdf"), o critério
      // mais preciso disponível para desempatar entre várias versões da
      // mesma música de artistas/igrejas diferentes.
      const batchId = (chord as any)?.import_batch_id;
      if (batchId) {
        try {
          const { data: batch } = await supabase
            .from('import_batches')
            .select('source_file_name')
            .eq('id', batchId)
            .maybeSingle();
          if (batch?.source_file_name) {
            const cleanName = batch.source_file_name
              .replace(/\.pdf$/i, '')
              .replace(/[_\-.]+/g, ' ')
              .trim();
            if (cleanName) queryParts.push(cleanName);
          }
        } catch (batchErr) {
          console.error('Não foi possível buscar o nome do PDF de origem para refinar a busca:', batchErr);
        }
      }

      queryParts.push('letra e cifra');
      const query = queryParts.join(' ');

      const { data } = await axios.get(`/api/youtube-search?q=${encodeURIComponent(query)}`);
      if (data.videoUrl) {
        setForm(prev => ({ ...prev, youtube_url: data.videoUrl }));
      }
    } catch (error) {
      console.error('Youtube search failed', error);
    } finally {
      setSearchingYoutube(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.artist || !form.content) {
      setNotification({ message: 'Por favor, preencha o título, artista e o conteúdo da cifra.', type: 'error' });
      return;
    }

    setLoading(true);

    // Limites de tamanho (evita que o upload trave a meio caminho e gere "Failed to fetch")
    const MAX_AUDIO_MB = 45;
    const MAX_ATTACHMENT_MB = 20;

    try {
      // Validação prévia de tamanho, ANTES de tentar subir qualquer coisa
      for (const att of attachments) {
        if (att.isNew && att.file) {
          const sizeMB = att.file.size / (1024 * 1024);
          const limit = att.type === 'audio' ? MAX_AUDIO_MB : MAX_ATTACHMENT_MB;
          if (sizeMB > limit) {
            throw new Error(
              `O arquivo "${att.file.name}" tem ${sizeMB.toFixed(1)}MB, acima do limite de ${limit}MB. Comprima o arquivo ou envie um menor.`
            );
          }
        }
      }

      const finalAttachments: { name: string; url: string; type: 'audio' | 'text' }[] = [];

      // Verificação rápida: o bucket "attachments" existe e responde? Isso isola se o problema
      // é o bucket (não existe / não é público) ou algo bloqueando a rede (firewall, ad-blocker, CORS).
      const needsAttachmentsBucket = attachments.some(a => a.isNew && a.file && a.type === 'text');
      if (needsAttachmentsBucket) {
        try {
          const { error: listError } = await supabase.storage.from('attachments').list('', { limit: 1 });
          if (listError) {
            throw new Error(`PRECHECK::Bucket "attachments": ${listError.message}`);
          }
        } catch (precheckErr: any) {
          if (precheckErr?.message?.startsWith('PRECHECK::')) throw precheckErr;
          console.error('Pré-checagem do bucket "attachments" falhou (rede):', precheckErr);
          throw new Error(
            'FAILED_TO_FETCH::A checagem inicial do bucket "attachments" já falhou por rede, antes mesmo do upload.'
          );
        }
      }

      for (const att of attachments) {
        if (att.isNew && att.file) {
          const file = att.file;
          const bucket = att.type === 'audio' ? 'audio' : 'attachments';
          const cleanName = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
          const fileName = `${Math.random().toString(36).substring(2)}_${cleanName}`;
          const filePath = `${att.type}/${fileName}`;

          // Tenta até 3 vezes com pequena pausa entre tentativas: cobre quedas
          // momentâneas de conexão (comum em rede móvel) sem incomodar o usuário.
          const MAX_ATTEMPTS = 3;
          let uploadError: any = null;
          let lastNetworkErr: any = null;

          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            uploadError = null;
            lastNetworkErr = null;
            try {
              const result = await supabase.storage
                .from(bucket)
                .upload(filePath, file, {
                  cacheControl: '3600',
                  upsert: false,
                  contentType: file.type || undefined,
                });
              uploadError = result.error;
            } catch (networkErr: any) {
              lastNetworkErr = networkErr;
            }

            // Sucesso (sem erro de rede nem erro do Supabase) -> sai do loop de tentativas
            if (!lastNetworkErr && !uploadError) break;

            if (attempt < MAX_ATTEMPTS) {
              console.warn(`Tentativa ${attempt} de enviar "${file.name}" falhou, tentando de novo...`, lastNetworkErr || uploadError);
              await new Promise(r => setTimeout(r, attempt * 800));
            }
          }

          if (lastNetworkErr) {
            // fetch falhou antes mesmo de o Supabase responder (rede, CORS, projeto pausado, etc.)
            console.error(`Falha de rede definitiva ao enviar "${file.name}":`, lastNetworkErr);
            throw new Error(
              `FAILED_TO_FETCH::Falha de rede ao enviar "${file.name}" para o bucket "${bucket}" (após ${MAX_ATTEMPTS} tentativas).`
            );
          }

          if (uploadError) {
            throw new Error(`Erro ao enviar "${file.name}": ${uploadError.message || uploadError}`);
          }

          const { data: { publicUrl } } = supabase.storage
            .from(bucket)
            .getPublicUrl(filePath);

          finalAttachments.push({
            name: att.name,
            url: publicUrl,
            type: att.type
          });
        } else {
          finalAttachments.push({
            name: att.name,
            url: att.url,
            type: att.type
          });
        }
      }

      // Mapeia os campos legados para manter compatibilidade com outras partes do sistema
      const primaryAudioUrl = finalAttachments.find(a => a.type === 'audio')?.url || '';
      const primaryAttachmentUrl = finalAttachments.find(a => a.type === 'text')?.url || '';

      const userId = profile?.id || (profile as any)?.uid;
      const payload = {
        title: form.title,
        artist: form.artist,
        category: form.categories.join(', '),
        content: form.content,
        original_key: form.original_key,
        youtube_url: form.youtube_url,
        audio_url: primaryAudioUrl,
        attachment_url: primaryAttachmentUrl,
        attachments: finalAttachments,
        owner_id: userId,
        updated_at: new Date().toISOString(),
      };

      console.log('Salvando cifra...', payload);

      if (chord) {
        const { error } = await supabase
          .from('chords')
          .update(payload)
          .eq('id', chord.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('chords')
          .insert([{ ...payload, created_at: new Date().toISOString() }])
          .select()
          .single();
        
        if (error) throw error;

        // Auto-associate with book if in book context
        if (bookId && data) {
          await supabase
            .from('chord_book_items')
            .insert([{ book_id: bookId, chord_id: data.id }]);
        }
      }
      
      setNotification({ message: 'Cifra salva com sucesso!', type: 'success' });
      setTimeout(() => onClose(), 1000);
    } catch (error: any) {
      console.error('Erro ao salvar cifra:', error);
      let errorMsg = error.message || 'Verifique sua conexão';

      if (errorMsg.startsWith('FAILED_TO_FETCH::') || errorMsg === 'Failed to fetch') {
        errorMsg = 'Não foi possível conectar ao Supabase (Failed to fetch). Causas comuns: 1) o projeto Supabase está pausado por inatividade (acesse o painel e reative); 2) as variáveis VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY não estão configuradas no Cloudflare Pages; 3) o domínio do site não está liberado em CORS no Supabase; 4) sua internet caiu no meio do envio.';
      } else if (errorMsg.startsWith('PRECHECK::')) {
        errorMsg = `Erro real encontrado: ${errorMsg.replace('PRECHECK::', '')}. O bucket "attachments" provavelmente não existe no seu projeto Supabase, ou não está com a política de leitura pública ativada. Vá em Storage no painel do Supabase e confira.`;
      } else if (errorMsg.includes('Bucket not found')) {
        errorMsg = 'Erro: Bucket de armazenamento não encontrado. Por favor, crie os buckets "audio" e "attachments" no painel Storage do seu Supabase e marque-os como "Public".';
      } else if (errorMsg.includes('column "attachment_url"')) {
        errorMsg = 'Erro: Banco de dados desatualizado. Por favor, execute o SQL no arquivo supabase_schema.sql no painel do seu Supabase para adicionar as novas colunas.';
      } else if (errorMsg.toLowerCase().includes('exceeded the maximum allowed size') || errorMsg.toLowerCase().includes('payload too large')) {
        errorMsg = 'Erro: o arquivo enviado é maior do que o limite permitido no seu bucket do Supabase Storage. Aumente o limite em Storage > Configurações ou envie um arquivo menor.';
      } else if (errorMsg.toLowerCase().includes('jwt') || errorMsg.toLowerCase().includes('invalid api key')) {
        errorMsg = 'Erro de autenticação com o Supabase. Verifique se a VITE_SUPABASE_ANON_KEY está correta e se sua sessão de login não expirou.';
      }

      setNotification({ message: errorMsg, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-4xl max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-brand-blue text-white">
          <h2 className="text-xl font-bold">{chord ? 'Editar Cifra' : 'Adicionar Nova Cifra'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg">
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-sm font-bold text-slate-700 mb-1 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-emerald-500" />
                    Importar de Arquivo
                  </label>
                  <div className="flex gap-2">
                    <button 
                      type="button"
                      onClick={() => setShowPDFImporter(true)}
                      className="w-full bg-emerald-500 text-white px-6 py-3 rounded-xl font-black hover:bg-emerald-600 transition-all flex items-center justify-center gap-3 shadow-lg shadow-emerald-500/20"
                    >
                      <FileText className="w-6 h-6" />
                      ESCANEAR PDF COM IA
                    </button>
                  </div>
                </div>
              </div>

              {showPDFImporter && (
                <PDFImporter 
                  onClose={() => setShowPDFImporter(false)}
                  onImportComplete={() => {
                    setShowPDFImporter(false);
                    onClose(); // Close the editor as PDFImporter already saved the data
                  }}
                  bookId={bookId}
                />
              )}

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Título</label>
                <input
                  required
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl"
                  value={form.title}
                  onChange={e => setForm({...form, title: e.target.value})}
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Artista</label>
                <input
                  required
                  className="w-full px-4 py-2 border border-slate-200 rounded-xl"
                  value={form.artist}
                  onChange={e => setForm({...form, artist: e.target.value})}
                />
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Categorias</label>

                  {/* Barra de pesquisa de categorias */}
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      value={categorySearch}
                      onChange={e => setCategorySearch(e.target.value)}
                      placeholder="Pesquisar categoria..."
                      className="w-full pl-9 pr-9 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-orange/40 focus:border-brand-orange"
                    />
                    {categorySearch && (
                      <button
                        type="button"
                        onClick={() => setCategorySearch('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 mb-3 max-h-48 overflow-y-auto pr-1">
                    {categories
                      .filter(cat =>
                        // Sempre mostra as categorias já selecionadas, mesmo que não batam com a busca
                        form.categories.includes(cat) ||
                        cat.toLowerCase().includes(categorySearch.trim().toLowerCase())
                      )
                      .map(cat => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => {
                            const newCategories = form.categories.includes(cat)
                              ? form.categories.filter(c => c !== cat)
                              : [...form.categories, cat];
                            setForm({...form, categories: newCategories});
                          }}
                          className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                            form.categories.includes(cat)
                              ? 'bg-brand-orange text-white shadow-md shadow-brand-orange/20'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {cat}
                        </button>
                      ))}
                    {categorySearch.trim() && !categories.some(cat => cat.toLowerCase().includes(categorySearch.trim().toLowerCase())) && (
                      <p className="text-xs text-slate-400 italic py-2">Nenhuma categoria encontrada.</p>
                    )}
                  </div>

                  {!showNewCategoryInput ? (
                    <button
                      type="button"
                      onClick={() => {
                        setNewCategory(categorySearch.trim());
                        setShowNewCategoryInput(true);
                      }}
                      className="text-xs font-bold text-brand-orange hover:underline flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" />
                      Adicionar Nova Categoria...
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        className="flex-1 px-4 py-2 border border-brand-orange rounded-xl text-sm focus:ring-brand-orange"
                        placeholder="Nova categoria..."
                        value={newCategory}
                        onChange={e => setNewCategory(e.target.value)}
                        autoFocus
                      />
                      <button 
                        type="button"
                        onClick={() => {
                          if (newCategory.trim()) {
                            const cat = newCategory.trim();
                            setCategories(prev => [...new Set([...prev, cat])]);
                            if (!form.categories.includes(cat)) {
                              setForm({...form, categories: [...form.categories, cat]});
                            }
                          }
                          setShowNewCategoryInput(false);
                          setNewCategory('');
                        }}
                        className="bg-brand-orange text-white p-2 rounded-xl"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Tom Original</label>
                  <input
                    className="w-full px-4 py-2 border border-slate-200 rounded-xl font-mono"
                    value={form.original_key}
                    onChange={e => setForm({...form, original_key: e.target.value})}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1 flex items-center gap-2">
                  <Youtube className="w-4 h-4 text-red-500" />
                  Link YouTube
                </label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 px-4 py-2 border border-slate-200 rounded-xl"
                    value={form.youtube_url}
                    onChange={e => setForm({...form, youtube_url: e.target.value})}
                  />
                  <button
                    type="button"
                    onClick={() => searchYoutube()}
                    disabled={searchingYoutube}
                    className="bg-red-500 text-white px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-50 flex items-center gap-2"
                  >
                    {searchingYoutube ? <Loader2 className="w-4 h-4 animate-spin" /> : <Youtube className="w-4 h-4" />}
                    BUSCAR
                  </button>
                </div>
              </div>

              <div className="space-y-4 pt-2 border-t border-slate-100">
                <p className="text-sm font-bold text-slate-800">Gerenciador de Mídias e Anexos (Múltiplos)</p>
                
                {/* Secao de Audios */}
                <div className="space-y-3">
                  <label className="block text-xs font-black text-emerald-600 uppercase tracking-wider flex items-center gap-2">
                    <Music className="w-4 h-4" />
                    Arquivos de Áudio ({attachments.filter(a => a.type === 'audio').length})
                  </label>
                  
                  {attachments.filter(a => a.type === 'audio').length > 0 && (
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {attachments.map((att, idx) => {
                        if (att.type !== 'audio') return null;
                        return (
                          <div key={idx} className="flex flex-col gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                            <div className="flex items-center gap-2">
                              <input 
                                type="text"
                                className="flex-1 bg-white border border-slate-200 px-3 py-1 rounded-lg text-sm font-medium focus:ring-1 focus:ring-emerald-500 outline-none"
                                value={att.name}
                                placeholder="Nome do áudio..."
                                onChange={(e) => handleRenameAttachment(idx, e.target.value)}
                              />
                              <button
                                type="button"
                                onClick={() => handleRemoveAttachment(idx)}
                                className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg transition-colors"
                                title="Remover"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                            {att.url ? (
                              <audio src={att.url} controls className="w-full h-8 max-w-full" />
                            ) : (
                              <span className="text-[10px] text-emerald-600 font-bold italic pl-1 flex items-center gap-1">
                                <span>⭐ Novo áudio selecionado:</span>
                                <span className="font-mono truncate max-w-[200px]">{att.file?.name}</span>
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <label className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-emerald-300 bg-emerald-50/10 text-emerald-700 hover:bg-emerald-50/30 rounded-2xl cursor-pointer transition-all">
                    <Plus className="w-5 h-5 text-emerald-500 animate-pulse" />
                    <span className="text-xs font-bold uppercase tracking-wider">Subir Outro Áudio</span>
                    <input 
                      type="file" 
                      className="hidden" 
                      accept="audio/*" 
                      multiple
                      onChange={e => {
                        if (e.target.files) {
                          Array.from(e.target.files).forEach((f: any) => handleAddAttachment('audio', f as File));
                        }
                      }} 
                    />
                  </label>
                </div>

                {/* Secao de Textos/Anexos */}
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <label className="block text-xs font-black text-brand-blue uppercase tracking-wider flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Arquivos de Letras, Partituras ou PDFs ({attachments.filter(a => a.type === 'text').length})
                  </label>
                  
                  {attachments.filter(a => a.type === 'text').length > 0 && (
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {attachments.map((att, idx) => {
                        if (att.type !== 'text') return null;
                        return (
                          <div key={idx} className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl justify-between">
                            <div className="flex-1 flex items-center gap-2 min-w-0">
                              <input 
                                type="text"
                                className="flex-1 bg-white border border-slate-200 px-3 py-1 rounded-lg text-sm font-medium focus:ring-1 focus:ring-brand-blue outline-none min-w-0"
                                value={att.name}
                                placeholder="Nome do anexo..."
                                onChange={(e) => handleRenameAttachment(idx, e.target.value)}
                              />
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {att.url ? (
                                <a 
                                  href={att.url} 
                                  target="_blank" 
                                  rel="noreferrer"
                                  className="p-1.5 hover:bg-brand-blue/10 text-brand-blue rounded-lg transition-colors"
                                  title="Ver Arquivo"
                                >
                                  <FileText className="w-4 h-4" />
                                </a>
                              ) : (
                                <span className="text-[10px] text-brand-blue font-bold italic truncate max-w-[120px]" title={att.file?.name}>
                                  Novo
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => handleRemoveAttachment(idx)}
                                className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg transition-colors"
                                title="Remover"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <label className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-brand-blue/30 bg-brand-blue/5 text-brand-blue hover:bg-brand-blue/10 rounded-2xl cursor-pointer transition-all">
                    <Plus className="w-5 h-5 text-brand-blue animate-pulse" />
                    <span className="text-xs font-bold uppercase tracking-wider">Subir Outro Anexo (PDF/TXT)</span>
                    <input 
                      type="file" 
                      className="hidden" 
                      accept=".pdf,.doc,.docx,.txt,image/*" 
                      multiple
                      onChange={e => {
                        if (e.target.files) {
                          Array.from(e.target.files).forEach((f: any) => handleAddAttachment('text', f as File));
                        }
                      }} 
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="flex flex-col h-full space-y-2">
              <div className="flex justify-between items-center gap-2 flex-wrap">
                <label className="block text-sm font-bold text-slate-700 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-brand-orange" />
                  Conteúdo (Letra e Cifras)
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={extractMetadataWithAI}
                    disabled={extractingMetadata || !form.content}
                    className="text-[10px] bg-brand-blue/10 px-3 py-1 rounded-lg text-brand-blue font-black hover:bg-brand-blue hover:text-white transition-all flex items-center gap-1 disabled:opacity-50"
                  >
                    {extractingMetadata ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    EXTRAIR INFO (IA)
                  </button>
                  <button
                    type="button"
                    onClick={convertToChordProWithAI}
                    disabled={convertingAI || !form.content}
                    className="text-[10px] bg-brand-orange/10 px-3 py-1 rounded-lg text-brand-orange font-black hover:bg-brand-orange hover:text-white transition-all flex items-center gap-1 disabled:opacity-50"
                  >
                    {convertingAI ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    CHORDPRO (IA)
                  </button>
                </div>
              </div>
              <textarea
                required
                className="w-full h-[700px] px-4 py-4 border border-slate-200 rounded-2xl font-mono text-base leading-relaxed resize-none focus:ring-2 focus:ring-brand-orange/20 outline-none overflow-y-auto shadow-inner bg-slate-50/5"
                placeholder="Cole aqui a cifra ou digite..."
                value={form.content}
                onChange={e => setForm({...form, content: e.target.value})}
              ></textarea>
              <div className="text-[10px] text-slate-400">
                Padrão: Coloque as cifras em uma linha própria acima da letra.
              </div>
            </div>
          </div>
        </form>

        <div className="p-6 border-t border-slate-100 flex justify-end gap-4 bg-slate-50">
          <button 
            type="button" 
            onClick={onClose}
            className="px-6 py-2 text-slate-500 font-bold hover:bg-slate-200 rounded-xl transition-colors"
          >
            CANCELAR
          </button>
          <button 
            onClick={handleSubmit}
            disabled={loading}
            className="px-8 py-2 bg-brand-orange text-white font-bold rounded-xl shadow-lg hover:bg-orange-600 transition-all flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
              <>
                <Save className="w-5 h-5" />
                SALVAR CIFRA
              </>
            )}
          </button>
        </div>
      </div>

      {/* Notificações */}
      {notification && (
        <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[120] px-6 py-3 rounded-2xl shadow-xl border animate-in slide-in-from-bottom-4 flex items-center gap-2 font-bold text-sm ${
          notification.type === 'success' ? 'bg-emerald-500 text-white border-emerald-400' : 'bg-red-500 text-white border-red-400'
        }`}>
          {notification.message}
        </div>
      )}
    </div>
  );
}
