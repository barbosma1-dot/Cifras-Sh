import { createClient } from '@supabase/supabase-js';

export const onRequestGet = async (context: any) => {
  const { request, env } = context;

  // 1. Authenticate using Bearer token
  const authHeader = request.headers.get("Authorization");
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Server configuration error: SUPABASE_SERVICE_ROLE_KEY is not configured." }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized: Missing Authorization header or incorrect format." }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const token = authHeader.substring(7);
  if (token !== serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Unauthorized: Invalid service role key." }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  if (!supabaseUrl) {
    return new Response(JSON.stringify({ error: "Server configuration error: VITE_SUPABASE_URL is not configured." }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    // Fetch total repertoires
    const { count: totalRepertoires, error: repError } = await supabase
      .from('repertoires')
      .select('*', { count: 'exact', head: true });

    if (repError) throw repError;

    // Fetch total chords
    const { count: totalChords, error: chordError } = await supabase
      .from('chords')
      .select('*', { count: 'exact', head: true });

    if (chordError) throw chordError;

    // Fetch missions
    const { data: mData, error: mError } = await supabase
      .from('missions')
      .select('id, name');

    if (mError) throw mError;

    // Fetch user profiles to aggregate active users per mission
    const { data: pData, error: pError } = await supabase
      .from('user_profiles')
      .select('id, mission_id');

    if (pError) throw pError;

    // Aggregate users per mission
    const userCountsByMission: { [key: string]: { missionName: string; count: number } } = {};
    if (mData) {
      mData.forEach((m: any) => {
        userCountsByMission[m.id] = {
          missionName: m.name,
          count: 0
        };
      });
    }

    let noMissionCount = 0;
    if (pData) {
      pData.forEach((p: any) => {
        if (p.mission_id && userCountsByMission[p.mission_id]) {
          userCountsByMission[p.mission_id].count += 1;
        } else {
          noMissionCount += 1;
        }
      });
    }

    const activeUsersByMissionList = Object.keys(userCountsByMission).map(id => ({
      missionId: id,
      missionName: userCountsByMission[id].missionName,
      count: userCountsByMission[id].count
    }));

    if (noMissionCount > 0) {
      activeUsersByMissionList.push({
        missionId: "null",
        missionName: "Sem Missão",
        count: noMissionCount
      });
    }

    const responseBody = {
      totalRepertoires: totalRepertoires || 0,
      totalChords: totalChords || 0,
      activeUsersByMission: activeUsersByMissionList,
      timestamp: new Date().toISOString()
    };

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });

  } catch (err: any) {
    console.error("Error generating summary report:", err);
    return new Response(JSON.stringify({ error: "Internal Server Error", details: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};
